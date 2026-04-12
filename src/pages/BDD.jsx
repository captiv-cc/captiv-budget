import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { notify } from '../lib/notify'
import { useAuth } from '../contexts/AuthContext'
import { fmtEur, UNITES } from '../lib/cotisations'
import {
  Plus,
  Search,
  Trash2,
  Database,
  X,
  Check,
  ChevronDown,
  Truck,
  Archive,
  ArchiveRestore,
  Copy,
} from 'lucide-react'
import TvaPicker from '../components/TvaPicker'
import { produitSchema, fournisseurSchema } from '../lib/schemas'
import { useFormValidation } from '../hooks/useFormValidation'
import FieldError from '../components/FieldError'

// ─── Constantes ─────────────────────────────────────────────────────────────

// Catégories par défaut — utilisées uniquement quand le catalogue est vide
const CAT_DEFAULTS = [
  'Humain',
  'Production',
  'Post-production',
  'Moyen technique',
  'VHR',
  'Frais',
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

// ─── Composant principal ────────────────────────────────────────────────────

export default function BDD() {
  const { org } = useAuth()
  const [produits, setProduits] = useState([])
  const [minimas, setMinimas] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [fournUsage, setFournUsage] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('catalogue')
  const [catFilter, setCatFilter] = useState('all')
  const [grilleFilter, setGrilleFilter] = useState('all') // type_oeuvre filter

  // Slide-over postes
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null) // null = create

  // Slide-over fournisseurs
  const [fournSlideOpen, setFournSlideOpen] = useState(false)
  const [fournForm, setFournForm] = useState(FOURN_EMPTY)
  const [fournEditingId, setFournEditingId] = useState(null)

  // Sections archivées
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [fournArchivedExpanded, setFournArchivedExpanded] = useState(false)

  const {
    errors: prodErrors,
    validate: validateProd,
    clearErrors: clearProdErrors,
    clearField: clearProdField,
  } = useFormValidation(produitSchema)
  const {
    errors: fournErrors,
    validate: validateFourn,
    clearErrors: clearFournErrors,
    clearField: clearFournField,
  } = useFormValidation(fournisseurSchema)

  // ── Load ──────────────────────────────────────────────────────────────────

  // Fetch paginé pour contourner la limite PostgREST (1000 rows par défaut)
  const fetchAllMinimas = useCallback(async () => {
    const PAGE = 1000
    let all = [], from = 0, done = false
    while (!done) {
      const { data, error } = await supabase
        .from('minimas_convention')
        .select('*')
        .order('poste')
        .range(from, from + PAGE - 1)
      if (error) { console.error('[BDD] load minimas:', error); break }
      all = all.concat(data || [])
      if (!data || data.length < PAGE) done = true
      else from += PAGE
    }
    return all
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [prodsRes, minimasAll, fournsRes, usageRes] = await Promise.all([
      supabase
        .from('produits_bdd')
        .select('*')
        .eq('org_id', org.id)
        .order('categorie')
        .order('produit'),
      fetchAllMinimas(),
      supabase.from('fournisseurs').select('*').eq('org_id', org.id).order('nom'),
      supabase.from('devis_lines').select('fournisseur_id').not('fournisseur_id', 'is', null),
    ])
    if (prodsRes.error) console.error('[BDD] load produits:', prodsRes.error)
    if (fournsRes.error) console.error('[BDD] load fournisseurs:', fournsRes.error)
    setProduits(prodsRes.data || [])
    setMinimas(minimasAll)
    setFournisseurs(fournsRes.data || [])
    const usage = {}
    for (const r of usageRes.data || []) {
      usage[r.fournisseur_id] = (usage[r.fournisseur_id] || 0) + 1
    }
    setFournUsage(usage)
    setLoading(false)
  }, [org?.id, fetchAllMinimas])

  useEffect(() => {
    if (org?.id) loadAll()
  }, [org?.id, loadAll])

  // ── Slide-over helpers ────────────────────────────────────────────────────

  function openCreatePoste(categorie = '') {
    setForm({ ...EMPTY, categorie })
    setEditingId(null)
    setSlideOpen(true)
    clearProdErrors()
  }

  function openEditPoste(item) {
    setForm({ ...EMPTY, ...item, tarif_defaut: item.tarif_defaut ?? '' })
    setEditingId(item.id)
    setSlideOpen(true)
    clearProdErrors()
  }

  function openCreateFourn() {
    setFournForm(FOURN_EMPTY)
    setFournEditingId(null)
    setFournSlideOpen(true)
    clearFournErrors()
  }

  function openEditFourn(item) {
    setFournForm({ ...FOURN_EMPTY, ...item })
    setFournEditingId(item.id)
    setFournSlideOpen(true)
    clearFournErrors()
  }

  // ── CRUD Postes ───────────────────────────────────────────────────────────

  async function savePoste(e) {
    e.preventDefault()
    const validated = validateProd(form)
    if (!validated) return
    const { id: _id, regime: _r, grille_cc_j: _g, created_at: _c, org_id: _o, ...rest } = form
    const payload = {
      ...rest,
      regime: form.regime || 'Externe',
      tarif_defaut: form.tarif_defaut !== '' ? parseFloat(form.tarif_defaut) || null : null,
      org_id: org.id,
    }
    if (!editingId) {
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
      notify.success('Élément créé')
    } else {
      const { data, error } = await supabase
        .from('produits_bdd')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      if (error) {
        notify.error(`Erreur : ${error.message}`)
        return
      }
      if (data) setProduits((p) => p.map((x) => (x.id === data.id ? data : x)))
      notify.success('Élément mis à jour')
    }
    setSlideOpen(false)
  }

  async function archivePoste(item) {
    if (!confirm(`Archiver « ${item.produit} » ? Il sera masqué de la liste principale.`)) return
    const { data, error } = await supabase
      .from('produits_bdd')
      .update({ actif: false })
      .eq('id', item.id)
      .select()
      .single()
    if (error) {
      notify.error(`Erreur : ${error.message}`)
      return
    }
    if (data) setProduits((p) => p.map((x) => (x.id === data.id ? data : x)))
  }

  async function unarchivePoste(item) {
    if (!confirm(`Réactiver « ${item.produit} » ?`)) return
    const { data, error } = await supabase
      .from('produits_bdd')
      .update({ actif: true })
      .eq('id', item.id)
      .select()
      .single()
    if (error) {
      notify.error(`Erreur : ${error.message}`)
      return
    }
    if (data) setProduits((p) => p.map((x) => (x.id === data.id ? data : x)))
  }

  async function deletePoste(id) {
    if (!confirm('Supprimer définitivement cet élément ? Cette action est irréversible.')) return
    const { error } = await supabase.from('produits_bdd').delete().eq('id', id)
    if (error) {
      notify.error('Impossible de supprimer : ' + error.message)
      return
    }
    setProduits((p) => p.filter((x) => x.id !== id))
    notify.success('Élément supprimé')
  }

  function duplicatePoste(item) {
    setForm({
      ...EMPTY,
      categorie: item.categorie || '',
      produit: item.produit + ' (copie)',
      description: item.description || '',
      unite: item.unite || 'J',
      tarif_defaut: item.tarif_defaut ?? '',
      notes: item.notes || '',
    })
    setEditingId(null)
    setSlideOpen(true)
    clearProdErrors()
  }

  // ── CRUD Fournisseurs ─────────────────────────────────────────────────────

  async function saveFourn(e) {
    e.preventDefault()
    const validated = validateFourn(fournForm)
    if (!validated) return
    const { id: _id, created_at: _c, org_id: _o, actif: _a, ...rest } = fournForm
    const payload = {
      nom: (rest.nom || '').trim(),
      type: rest.type || null,
      siret: rest.siret || null,
      email: rest.email || null,
      phone: rest.phone || null,
      notes: rest.notes || null,
      default_tva: Number(rest.default_tva ?? 20),
      org_id: org.id,
    }
    if (!payload.nom) {
      notify.warn('Le nom est obligatoire.')
      return
    }
    if (!fournEditingId) {
      const { data, error } = await supabase.from('fournisseurs').insert(payload).select().single()
      if (error) {
        notify.error(`Erreur : ${error.message}`)
        return
      }
      if (data) setFournisseurs((p) => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom)))
      notify.success('Fournisseur créé')
    } else {
      const { data, error } = await supabase
        .from('fournisseurs')
        .update(payload)
        .eq('id', fournEditingId)
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
      notify.success('Fournisseur mis à jour')
    }
    setFournSlideOpen(false)
  }

  async function archiveFourn(f) {
    if (!confirm(`Archiver « ${f.nom} » ?`)) return
    const { data, error } = await supabase
      .from('fournisseurs')
      .update({ actif: false })
      .eq('id', f.id)
      .select()
      .single()
    if (error) {
      notify.error(`Erreur : ${error.message}`)
      return
    }
    if (data) setFournisseurs((p) => p.map((x) => (x.id === data.id ? data : x)))
  }

  async function unarchiveFourn(f) {
    if (!confirm(`Réactiver « ${f.nom} » ?`)) return
    const { data, error } = await supabase
      .from('fournisseurs')
      .update({ actif: true })
      .eq('id', f.id)
      .select()
      .single()
    if (error) {
      notify.error(`Erreur : ${error.message}`)
      return
    }
    if (data) setFournisseurs((p) => p.map((x) => (x.id === data.id ? data : x)))
  }

  async function deleteFourn(f) {
    const count = fournUsage[f.id] || 0
    const msg =
      count > 0
        ? `Supprimer définitivement « ${f.nom} » ?\n\n⚠ Ce fournisseur est utilisé sur ${count} ligne${count > 1 ? 's' : ''} de devis.\nLes lignes ne seront pas supprimées, mais leur lien fournisseur sera vidé.\n\nCette action est irréversible.`
        : `Supprimer définitivement « ${f.nom} » ? Cette action est irréversible.`
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
    notify.success('Fournisseur supprimé')
  }

  // ── Filtrage & regroupement ───────────────────────────────────────────────

  const { activePostes, archivedPostes, catCounts, allCategories } = useMemo(() => {
    const sq = search.trim().toLowerCase()
    const matchSearch = (p) =>
      !sq ||
      p.produit?.toLowerCase().includes(sq) ||
      p.categorie?.toLowerCase().includes(sq) ||
      p.description?.toLowerCase().includes(sq) ||
      p.notes?.toLowerCase().includes(sq)

    const active = []
    const archived = []
    const counts = { all: 0 }
    const catSet = new Set()

    for (const p of produits) {
      const cat = p.categorie?.trim() || ''
      if (cat) catSet.add(cat)

      if (!p.actif) {
        if (matchSearch(p)) archived.push(p)
        continue
      }
      counts.all++
      if (counts[cat] === undefined) counts[cat] = 0
      counts[cat]++
      if (matchSearch(p) && (catFilter === 'all' || (p.categorie?.trim() || '') === catFilter)) {
        active.push(p)
      }
    }

    active.sort(
      (a, b) =>
        (a.categorie || '').localeCompare(b.categorie || '', 'fr') ||
        a.produit.localeCompare(b.produit, 'fr'),
    )
    archived.sort((a, b) => a.produit.localeCompare(b.produit, 'fr'))

    const cats = [...catSet].sort((a, b) => a.localeCompare(b, 'fr'))
    return { activePostes: active, archivedPostes: archived, catCounts: counts, allCategories: cats }
  }, [produits, search, catFilter])

  const {
    activeFourns,
    archivedFourns,
    fournTypeCounts,
  } = useMemo(() => {
    const sq = search.trim().toLowerCase()
    const matchSearch = (f) =>
      !sq ||
      f.nom?.toLowerCase().includes(sq) ||
      f.type?.toLowerCase().includes(sq) ||
      f.notes?.toLowerCase().includes(sq)

    const active = []
    const archived = []
    const counts = { all: 0 }

    for (const f of fournisseurs) {
      if (f.actif === false) {
        if (matchSearch(f)) archived.push(f)
        continue
      }
      counts.all++
      if (matchSearch(f)) active.push(f)
    }

    active.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
    archived.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

    return { activeFourns: active, archivedFourns: archived, fournTypeCounts: counts }
  }, [fournisseurs, search])

  // Grille CC — pivot minimas_convention en lignes uniques par poste
  const { grillePivoted, grilleTypeCounts } = useMemo(() => {
    const sq = search.trim().toLowerCase()
    // Pivot : (poste, type_oeuvre, is_specialise, filiere, niveau) → { jour_7h, jour_8h, sem_35h, sem_39h }
    const map = new Map()
    const counts = { all: 0, Fiction: 0, Flux: 0, Hors_fiction_flux: 0 }

    for (const m of minimas) {
      const key = `${m.poste}|${m.type_oeuvre}|${m.is_specialise}`
      if (!map.has(key)) {
        map.set(key, {
          poste: m.poste,
          type_oeuvre: m.type_oeuvre,
          is_specialise: m.is_specialise,
          filiere: m.filiere,
          niveau: m.niveau,
          jour_7h: null,
          jour_8h: null,
          sem_35h: null,
          sem_39h: null,
        })
      }
      const entry = map.get(key)
      if (m.unite === 'jour_7h') entry.jour_7h = m.montant_brut
      else if (m.unite === 'jour_8h') entry.jour_8h = m.montant_brut
      else if (m.unite === 'semaine_35h') entry.sem_35h = m.montant_brut
      else if (m.unite === 'semaine_39h') entry.sem_39h = m.montant_brut
    }

    const all = [...map.values()]

    // Compteurs par type (avant filtre recherche)
    for (const row of all) {
      counts.all++
      if (counts[row.type_oeuvre] !== undefined) counts[row.type_oeuvre]++
    }

    // Appliquer filtre recherche + type_oeuvre
    const filtered = all.filter((row) => {
      if (grilleFilter !== 'all' && row.type_oeuvre !== grilleFilter) return false
      if (sq && !row.poste?.toLowerCase().includes(sq) && !row.filiere?.toLowerCase().includes(sq))
        return false
      return true
    })

    filtered.sort((a, b) => a.poste.localeCompare(b.poste, 'fr'))
    return { grillePivoted: filtered, grilleTypeCounts: counts }
  }, [minimas, search, grilleFilter])

  // Grouper postes actifs par catégorie pour l'affichage
  const activeByCategory = useMemo(() => {
    const groups = {}
    for (const p of activePostes) {
      const cat = p.categorie?.trim() || ''
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(p)
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === '' && b !== '') return 1
      if (a !== '' && b === '') return -1
      return a.localeCompare(b, 'fr')
    })
  }, [activePostes])

  // Auto-expand archived sections on search match
  const showArchivedPostes =
    archivedExpanded || (search.trim() !== '' && archivedPostes.length > 0)
  const showArchivedFourns =
    fournArchivedExpanded || (search.trim() !== '' && archivedFourns.length > 0)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>
            Catalogue
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {tab === 'catalogue' && <>{catCounts.all} élément{catCounts.all !== 1 ? 's' : ''} · régime et bloc choisis à l&apos;ajout dans le devis</>}
            {tab === 'fournisseurs' && <>{fournTypeCounts.all} fournisseur{fournTypeCounts.all !== 1 ? 's' : ''}</>}
            {tab === 'grille' && <>Grille convention collective audiovisuelle</>}
          </p>
        </div>
        {tab === 'catalogue' && !slideOpen && (
          <button onClick={() => openCreatePoste()} className="btn-primary">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nouvel élément</span>
          </button>
        )}
        {tab === 'fournisseurs' && !fournSlideOpen && (
          <button onClick={openCreateFourn} className="btn-primary">
            <Plus className="w-4 h-4" />{' '}
            <span className="hidden sm:inline">Nouveau fournisseur</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-5 p-1 rounded-xl w-fit overflow-x-auto"
        style={{ background: 'var(--bg-elev)' }}
      >
        {[
          ['catalogue', 'Éléments & prestations'],
          ['fournisseurs', 'Fournisseurs'],
          ['grille', 'Grille CC Audiovisuelle'],
        ].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => { setTab(val); setSearch(''); setCatFilter('all'); setGrilleFilter('all') }}
            className="px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap"
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
      <div className="relative mb-4">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--txt-3)' }}
        />
        <input
          className="input pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            tab === 'catalogue'
              ? 'Rechercher un élément…'
              : tab === 'fournisseurs'
                ? 'Rechercher un fournisseur…'
                : 'Rechercher dans la grille CC…'
          }
        />
      </div>

      {/* ── FilterChips (catalogue only) ──────────────────────────────────── */}
      {tab === 'catalogue' && (
        <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
          <FilterChip
            label="Tous"
            count={catCounts.all}
            active={catFilter === 'all'}
            onClick={() => setCatFilter('all')}
          />
          {allCategories.map((cat) => (
            <FilterChip
              key={cat}
              label={cat}
              count={catCounts[cat] || 0}
              active={catFilter === cat}
              onClick={() => setCatFilter(cat)}
            />
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: POSTES & PRESTATIONS
          ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'catalogue' && (
        <>
          {loading && (
            <div className="card p-8 text-center text-sm" style={{ color: 'var(--txt-3)' }}>
              Chargement…
            </div>
          )}

          {!loading && activePostes.length === 0 && (
            <div className="card p-12 text-center">
              <Database className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
              <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
                {search || catFilter !== 'all' ? 'Aucun résultat' : 'Catalogue vide'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
                {search || catFilter !== 'all'
                  ? 'Essayez un autre terme ou ajoutez cet élément au catalogue'
                  : 'Ajoutez vos éléments habituels — ils seront proposés à la création de devis'}
              </p>
              {!search && catFilter === 'all' && (
                <button onClick={() => openCreatePoste()} className="btn-primary btn-sm mt-4">
                  <Plus className="w-3.5 h-3.5" /> Premier élément
                </button>
              )}
            </div>
          )}

          {!loading && activePostes.length > 0 && (
            <div className="space-y-3">
              {activeByCategory.map(([cat, items]) => (
                <PosteCategoryGroup
                  key={cat || '__sans_cat'}
                  cat={cat}
                  items={items}
                  onEdit={openEditPoste}
                  onArchive={archivePoste}
                  onDuplicate={duplicatePoste}
                  onAddToCategory={openCreatePoste}
                />
              ))}
            </div>
          )}

          {/* Section archivés */}
          {!loading && (archivedPostes.length > 0 || archivedExpanded) && (
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
                  style={{ transform: showArchivedPostes ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
                <Archive className="w-3.5 h-3.5" />
                <span>Éléments archivés ({archivedPostes.length})</span>
              </button>

              {showArchivedPostes && (
                <div className="mt-3">
                  {archivedPostes.length === 0 && (
                    <p className="text-xs px-1" style={{ color: 'var(--txt-3)' }}>
                      Aucun élément archivé.
                    </p>
                  )}
                  {archivedPostes.length > 0 && (
                    <div
                      className="card"
                      style={{ overflow: 'hidden', opacity: 0.75 }}
                    >
                      {archivedPostes.map((item, i) => (
                        <PosteRow
                          key={item.id}
                          item={item}
                          isFirst={i === 0}
                          onEdit={openEditPoste}
                          onUnarchive={unarchivePoste}
                          onDelete={deletePoste}
                          archived
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: FOURNISSEURS
          ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'fournisseurs' && (
        <>
          {loading && (
            <div className="card p-8 text-center text-sm" style={{ color: 'var(--txt-3)' }}>
              Chargement…
            </div>
          )}

          {!loading && activeFourns.length === 0 && (
            <div className="card p-12 text-center">
              <Truck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
              <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
                {search ? 'Aucun résultat' : 'Aucun fournisseur'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
                {search
                  ? 'Essayez un autre terme ou ajoutez ce fournisseur'
                  : 'Ajoutez vos fournisseurs habituels — ils seront proposés dans le budget réel'}
              </p>
              {!search && (
                <button onClick={openCreateFourn} className="btn-primary btn-sm mt-4">
                  <Plus className="w-3.5 h-3.5" /> Premier fournisseur
                </button>
              )}
            </div>
          )}

          {!loading && activeFourns.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }}>
              {activeFourns.map((f, i) => (
                <FournisseurRow
                  key={f.id}
                  item={f}
                  usage={fournUsage[f.id] || 0}
                  isFirst={i === 0}
                  onEdit={openEditFourn}
                  onArchive={archiveFourn}
                />
              ))}
            </div>
          )}

          {/* Section fournisseurs archivés */}
          {!loading && (archivedFourns.length > 0 || fournArchivedExpanded) && (
            <div className="mt-8">
              <button
                onClick={() => setFournArchivedExpanded((v) => !v)}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-1 py-1.5 rounded transition-colors"
                style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
              >
                <ChevronDown
                  className="w-3.5 h-3.5 transition-transform"
                  style={{ transform: showArchivedFourns ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
                <Archive className="w-3.5 h-3.5" />
                <span>Fournisseurs archivés ({archivedFourns.length})</span>
              </button>

              {showArchivedFourns && (
                <div className="mt-3">
                  {archivedFourns.length === 0 && (
                    <p className="text-xs px-1" style={{ color: 'var(--txt-3)' }}>
                      Aucun fournisseur archivé.
                    </p>
                  )}
                  {archivedFourns.length > 0 && (
                    <div className="card" style={{ overflow: 'hidden', opacity: 0.75 }}>
                      {archivedFourns.map((f, i) => (
                        <FournisseurRow
                          key={f.id}
                          item={f}
                          usage={fournUsage[f.id] || 0}
                          isFirst={i === 0}
                          onEdit={openEditFourn}
                          onUnarchive={unarchiveFourn}
                          onDelete={deleteFourn}
                          archived
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: GRILLE CC — minimas_convention (lecture seule)
          ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'grille' && (
        <>
          {/* Sous-onglets type d'œuvre */}
          <div
            className="flex items-center gap-0 mb-4 overflow-x-auto"
            style={{
              borderBottom: '1px solid var(--brd-sub)',
            }}
          >
            {[
              ['all', 'Tous', grilleTypeCounts.all],
              ['Fiction', 'Fiction', grilleTypeCounts.Fiction],
              ['Flux', 'Flux / Plateau', grilleTypeCounts.Flux],
              ['Hors_fiction_flux', 'Doc / Autres', grilleTypeCounts.Hors_fiction_flux],
            ].map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setGrilleFilter(key)}
                className="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
                style={{
                  color: grilleFilter === key ? 'var(--blue)' : 'var(--txt-3)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {label}
                <span
                  className="ml-1.5 text-xs"
                  style={{ opacity: 0.7 }}
                >
                  {count || 0}
                </span>
                {grilleFilter === key && (
                  <span
                    className="absolute bottom-0 left-0 right-0"
                    style={{ height: 2, background: 'var(--blue)', borderRadius: '1px 1px 0 0' }}
                  />
                )}
              </button>
            ))}
          </div>

          {loading && (
            <div className="card p-8 text-center text-sm" style={{ color: 'var(--txt-3)' }}>
              Chargement…
            </div>
          )}

          {!loading && grillePivoted.length === 0 && (
            <div className="card p-12 text-center">
              <Database className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
              <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
                Aucun résultat
              </p>
            </div>
          )}

          {!loading && grillePivoted.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 700 }}>
                  <thead>
                    <tr
                      className="text-[11px] font-semibold uppercase"
                      style={{
                        color: 'var(--txt-3)',
                        borderBottom: '1px solid var(--brd-sub)',
                        background: 'var(--bg-elev)',
                      }}
                    >
                      <th className="px-3 sm:px-4 py-2.5 text-left">Poste</th>
                      <th className="px-2 py-2.5 text-center">Filière</th>
                      <th className="px-2 py-2.5 text-center">Niveau</th>
                      <th className="px-2 py-2.5 text-right">Jour 7h</th>
                      <th className="px-2 py-2.5 text-right">Jour 8h</th>
                      <th className="px-2 py-2.5 text-right">Sem. 35h</th>
                      <th className="px-2 sm:px-3 py-2.5 text-right">Sem. 39h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grillePivoted.map((row, i) => (
                      <tr
                        key={`${row.poste}-${row.type_oeuvre}-${row.is_specialise}-${i}`}
                        style={{ borderBottom: '1px solid var(--brd-sub)' }}
                        className="transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td className="px-3 sm:px-4 py-2.5">
                          <span className="font-medium" style={{ color: 'var(--txt)' }}>
                            {row.poste}
                          </span>
                          {row.is_specialise && (
                            <span
                              className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
                            >
                              spécialisé
                            </span>
                          )}
                          {grilleFilter === 'all' && (
                            <span
                              className="ml-1.5 text-[10px] hidden sm:inline"
                              style={{ color: 'var(--txt-3)' }}
                            >
                              {row.type_oeuvre === 'Fiction'
                                ? 'Fiction'
                                : row.type_oeuvre === 'Flux'
                                  ? 'Flux'
                                  : 'Doc/Autres'}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-2 py-2.5 text-center text-xs"
                          style={{ color: 'var(--txt-3)' }}
                        >
                          {row.filiere || '—'}
                        </td>
                        <td
                          className="px-2 py-2.5 text-center text-xs"
                          style={{ color: 'var(--txt-3)' }}
                        >
                          {row.niveau || '—'}
                        </td>
                        <GrilleCell value={row.jour_7h} primary />
                        <GrilleCell value={row.jour_8h} />
                        <GrilleCell value={row.sem_35h} />
                        <GrilleCell value={row.sem_39h} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SLIDE-OVER : POSTE
          ═══════════════════════════════════════════════════════════════════ */}
      {slideOpen && (
        <>
          <div
            className="fixed inset-0 z-40 transition-opacity"
            style={{ background: 'rgba(0,0,0,.5)' }}
            onClick={() => setSlideOpen(false)}
          />
          <div
            className="fixed top-0 right-0 bottom-0 z-50 w-full flex flex-col"
            style={{
              maxWidth: '90vw',
              width: 480,
              background: 'var(--bg-surf)',
              borderLeft: '1px solid var(--brd-sub)',
              boxShadow: '-8px 0 30px rgba(0,0,0,.25)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 sm:px-6 py-4 shrink-0"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                {editingId ? 'Modifier l\'élément' : 'Nouvel élément'}
              </h2>
              <div className="flex items-center gap-2">
                {editingId && (
                  <button
                    onClick={() => {
                      setSlideOpen(false)
                      setTimeout(() => deletePoste(editingId), 100)
                    }}
                    className="btn-ghost btn-sm"
                    style={{ color: 'var(--txt-3)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                    title="Supprimer définitivement cet élément"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setSlideOpen(false)}
                  className="btn-ghost btn-sm"
                  style={{ color: 'var(--txt-3)' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Form */}
            <form
              onSubmit={savePoste}
              className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4"
            >
              <div>
                <label className="label">Intitulé *</label>
                <input
                  className="input"
                  required
                  autoFocus
                  value={form.produit}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, produit: e.target.value }))
                    clearProdField('produit')
                  }}
                  placeholder="Ex : Directeur de production, Location caméra…"
                />
                <FieldError error={prodErrors.produit} />
              </div>

              <div>
                <label className="label">
                  Sous-catégorie
                  <span className="ml-1 font-normal" style={{ color: 'var(--txt-3)' }}>
                    (pour regrouper)
                  </span>
                </label>
                <input
                  className="input"
                  list="cat-suggestions"
                  value={form.categorie}
                  onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value }))}
                  placeholder="Ex : Direction, Caméra, Transport…"
                />
                <datalist id="cat-suggestions">
                  {[...new Set([...CAT_DEFAULTS, ...allCategories])].sort((a, b) => a.localeCompare(b, 'fr')).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

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
                  className="input resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ce texte sera copié dans la colonne Description du devis…"
                />
              </div>

              <div className="flex gap-3">
                <div className="w-28">
                  <label className="label">Unité</label>
                  <select
                    className="input"
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
                    className="input text-right"
                    min={0}
                    step={0.01}
                    value={form.tarif_defaut}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, tarif_defaut: e.target.value }))
                      clearProdField('tarif_defaut')
                    }}
                    placeholder="Point de départ"
                  />
                  <FieldError error={prodErrors.tarif_defaut} />
                </div>
              </div>

              <div>
                <label className="label">
                  Notes{' '}
                  <span className="font-normal" style={{ color: 'var(--txt-3)' }}>
                    (fournisseur, conditions…)
                  </span>
                </label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </form>

            {/* Footer */}
            <div
              className="flex justify-end gap-2 px-4 sm:px-6 py-4 shrink-0"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <button
                type="button"
                onClick={() => setSlideOpen(false)}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button type="submit" onClick={savePoste} className="btn-primary">
                <Check className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SLIDE-OVER : FOURNISSEUR
          ═══════════════════════════════════════════════════════════════════ */}
      {fournSlideOpen && (
        <>
          <div
            className="fixed inset-0 z-40 transition-opacity"
            style={{ background: 'rgba(0,0,0,.5)' }}
            onClick={() => setFournSlideOpen(false)}
          />
          <div
            className="fixed top-0 right-0 bottom-0 z-50 w-full flex flex-col"
            style={{
              maxWidth: '90vw',
              width: 480,
              background: 'var(--bg-surf)',
              borderLeft: '1px solid var(--brd-sub)',
              boxShadow: '-8px 0 30px rgba(0,0,0,.25)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 sm:px-6 py-4 shrink-0"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                {fournEditingId ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
              </h2>
              <div className="flex items-center gap-2">
                {fournEditingId && (
                  <button
                    onClick={() => {
                      const f = fournisseurs.find((x) => x.id === fournEditingId)
                      if (f) {
                        setFournSlideOpen(false)
                        setTimeout(() => deleteFourn(f), 100)
                      }
                    }}
                    className="btn-ghost btn-sm"
                    style={{ color: 'var(--txt-3)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                    title="Supprimer définitivement"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setFournSlideOpen(false)}
                  className="btn-ghost btn-sm"
                  style={{ color: 'var(--txt-3)' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Form */}
            <form
              onSubmit={saveFourn}
              className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4"
            >
              <div>
                <label className="label">Nom *</label>
                <input
                  className="input"
                  required
                  autoFocus
                  value={fournForm.nom}
                  onChange={(e) => {
                    setFournForm((f) => ({ ...f, nom: e.target.value }))
                    clearFournField('nom')
                  }}
                  placeholder="Ex : CINECOM, Panavision…"
                />
                <FieldError error={fournErrors.nom} />
              </div>

              <div>
                <label className="label">
                  Type{' '}
                  <span className="font-normal" style={{ color: 'var(--txt-3)' }}>
                    (optionnel)
                  </span>
                </label>
                <input
                  className="input"
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
                    className="input"
                    value={fournForm.email || ''}
                    onChange={(e) => {
                      setFournForm((f) => ({ ...f, email: e.target.value }))
                      clearFournField('email')
                    }}
                    placeholder="contact@…"
                  />
                  <FieldError error={fournErrors.email} />
                </div>
                <div className="flex-1">
                  <label className="label">Téléphone</label>
                  <input
                    className="input"
                    value={fournForm.phone || ''}
                    onChange={(e) => {
                      setFournForm((f) => ({ ...f, phone: e.target.value }))
                      clearFournField('phone')
                    }}
                    placeholder="06…"
                  />
                  <FieldError error={fournErrors.phone} />
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
                  className="input"
                  value={fournForm.siret || ''}
                  onChange={(e) => {
                    setFournForm((f) => ({ ...f, siret: e.target.value }))
                    clearFournField('siret')
                  }}
                  placeholder="14 chiffres"
                />
                <FieldError error={fournErrors.siret} />
              </div>

              <TvaPicker
                value={fournForm.default_tva}
                onChange={(v) => setFournForm((f) => ({ ...f, default_tva: v }))}
                label="TVA par défaut · 20% pour la majorité, 0% si étranger / exonéré"
              />

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={fournForm.notes || ''}
                  onChange={(e) => setFournForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Conditions, contact privilégié…"
                />
              </div>
            </form>

            {/* Footer */}
            <div
              className="flex justify-end gap-2 px-4 sm:px-6 py-4 shrink-0"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <button
                type="button"
                onClick={() => setFournSlideOpen(false)}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button type="submit" onClick={saveFourn} className="btn-primary">
                <Check className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Composants internes ──────────────────────────────────────────────────────

function PosteCategoryGroup({ cat, items, onEdit, onArchive, onDuplicate, onAddToCategory }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {/* En-tête catégorie */}
      <div
        className="flex items-center gap-3 px-3 sm:px-5 py-2.5"
        style={{ background: 'var(--bg-elev)', borderLeft: '4px solid var(--blue)' }}
      >
        <span
          className="text-xs font-bold uppercase tracking-wider flex-1"
          style={{ color: cat ? 'var(--blue)' : 'var(--txt-3)' }}
        >
          {cat || 'Sans catégorie'}
        </span>
        <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
          {items.length} élément{items.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => onAddToCategory(cat)}
          className="btn-ghost btn-sm"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          title="Ajouter un élément dans cette catégorie"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Lignes */}
      {items.map((item, i) => (
        <PosteRow
          key={item.id}
          item={item}
          isFirst={i === 0}
          onEdit={onEdit}
          onArchive={onArchive}
          onDuplicate={onDuplicate}
        />
      ))}
    </div>
  )
}

function PosteRow({ item, isFirst, onEdit, onArchive, onUnarchive, onDuplicate, onDelete, archived }) {
  return (
    <div
      className="flex items-center justify-between px-3 sm:px-5 py-3 sm:py-3.5 transition-colors group"
      style={{ borderTop: isFirst ? 'none' : '1px solid var(--brd-sub)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Left: info */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onEdit(item)}
      >
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {item.produit}
          </p>
          {item.ref && (
            <span className="text-[11px] shrink-0" style={{ color: 'var(--txt-3)' }}>
              #{item.ref}
            </span>
          )}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--txt-3)' }}>
          {item.description || item.notes || (archived ? item.categorie || '—' : '—')}
        </p>
      </div>

      {/* Center: unite + tarif */}
      <div className="flex items-center gap-3 ml-3 shrink-0">
        <span className="text-xs hidden sm:inline" style={{ color: 'var(--txt-3)' }}>
          {item.unite}
        </span>
        <span
          className="text-sm font-semibold min-w-[70px] text-right"
          style={{ color: item.tarif_defaut ? 'var(--txt)' : 'var(--txt-3)' }}
        >
          {item.tarif_defaut ? fmtEur(item.tarif_defaut) : '—'}
        </span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 ml-3 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {!archived && onDuplicate && (
          <button
            onClick={() => onDuplicate(item)}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--txt-3)' }}
            title="Dupliquer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {!archived && onArchive && (
          <button
            onClick={() => onArchive(item)}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--txt-3)' }}
            title="Archiver"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
        {archived && onUnarchive && (
          <button
            onClick={() => onUnarchive(item)}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--txt-3)' }}
            title="Désarchiver"
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
          </button>
        )}
        {archived && onDelete && (
          <button
            onClick={() => onDelete(item.id)}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
            title="Supprimer définitivement"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function FournisseurRow({ item, usage, isFirst, onEdit, onArchive, onUnarchive, onDelete, archived }) {
  return (
    <div
      className="flex items-center justify-between px-3 sm:px-5 py-3 sm:py-3.5 transition-colors group"
      style={{ borderTop: isFirst ? 'none' : '1px solid var(--brd-sub)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Left: info */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onEdit(item)}
      >
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {item.nom}
          </p>
          {item.type && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
            >
              {item.type}
            </span>
          )}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--txt-3)' }}>
          {item.notes || '—'}
        </p>
      </div>

      {/* Center: usage count */}
      {usage > 0 && (
        <span
          className="text-[11px] px-2 py-0.5 rounded-full shrink-0 ml-3 hidden sm:inline"
          style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
        >
          {usage} devis
        </span>
      )}

      {/* Right: actions */}
      <div className="flex items-center gap-1 ml-3 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {!archived && onArchive && (
          <button
            onClick={() => onArchive(item)}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--txt-3)' }}
            title="Archiver"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
        {archived && onUnarchive && (
          <button
            onClick={() => onUnarchive(item)}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--txt-3)' }}
            title="Désarchiver"
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
          </button>
        )}
        {archived && onDelete && (
          <button
            onClick={() => onDelete(item)}
            className="btn-ghost btn-sm"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
            title="Supprimer définitivement"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function GrilleCell({ value, primary }) {
  if (!value) {
    return (
      <td className="px-2 py-2.5 text-right text-xs" style={{ color: 'var(--txt-3)' }}>
        —
      </td>
    )
  }
  return (
    <td
      className="px-2 py-2.5 text-right text-sm tabular-nums"
      style={{ color: primary ? 'var(--green)' : 'var(--txt-2)', fontWeight: primary ? 600 : 400 }}
    >
      {fmtEur(value)}
    </td>
  )
}

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium rounded-full px-3 py-1.5 transition-all flex items-center gap-1.5 whitespace-nowrap"
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

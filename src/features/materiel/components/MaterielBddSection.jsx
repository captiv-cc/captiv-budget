// ════════════════════════════════════════════════════════════════════════════
// MaterielBddSection — MAT-6
// ════════════════════════════════════════════════════════════════════════════
//
// Section catalogue matériel, intégrée en tant que 4e onglet de la page BDD.
// Le catalogue `materiel_bdd` est autonome (pas de lien avec produits_bdd).
// Il sert d'autocomplete/référentiel lors de la saisie des items matériel
// d'un projet (MateriauxTable → colonne Désignation — câblage optionnel).
//
// Colonnes stockées : nom, categorie_suggeree, sous_categorie_suggeree,
//                     description, tags[], actif.
//
// Features :
//   - Liste filtrable (search + chips catégorie)
//   - Créer / modifier / soft-delete (actif=false) / restaurer
//   - Slide-over droite pour le formulaire
//   - Section "Archivés" pliable
//
// Composant 100% self-contained : fetch/mutations via lib/materiel.js.
// Charge via `useAuth().org` pour connaître l'org courante.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Search,
  X,
  Archive,
  ArchiveRestore,
  Package,
  ChevronDown,
  Edit3,
  Tag,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import {
  fetchMaterielBdd,
  createMaterielBdd,
  updateMaterielBdd,
} from '../../../lib/materiel'
import { notify } from '../../../lib/notify'
import { confirm } from '../../../lib/confirm'
import { useAuth } from '../../../contexts/AuthContext'

// ─── Form empty state ───────────────────────────────────────────────────────

const EMPTY_FORM = {
  nom: '',
  categorie_suggeree: '',
  sous_categorie_suggeree: '',
  description: '',
  tagsText: '', // texte brut (séparé par virgules) — converti en array à la save
}

/** Catégories par défaut si catalogue vide. */
const CATEGORIE_DEFAULTS = [
  'Caméra',
  'Optiques',
  'Machinerie',
  'Lumière',
  'Son',
  'Régie',
  'Consommables',
  'Autre',
]

// ═════════════════════════════════════════════════════════════════════════════
// Composant principal
// ═════════════════════════════════════════════════════════════════════════════

export default function MaterielBddSection() {
  const { org } = useAuth()
  const orgId = org?.id

  const [items, setItems] = useState([]) // items actifs
  const [archived, setArchived] = useState([]) // items actif=false
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [archivedExpanded, setArchivedExpanded] = useState(false)

  // Slide-over
  const [slideOpen, setSlideOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  // ─── Load ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // fetchMaterielBdd ne ramène que les actifs. On fait une requête dédiée
      // pour les archivés (on veut pouvoir les restaurer).
      const [actifs, { data: archData, error: archErr }] = await Promise.all([
        fetchMaterielBdd(),
        supabase
          .from('materiel_bdd')
          .select('*')
          .eq('actif', false)
          .order('nom', { ascending: true }),
      ])
      if (archErr) throw archErr
      setItems(actifs)
      setArchived(archData || [])
    } catch (err) {
      console.error('[MaterielBddSection] load', err)
      notify.error('Erreur chargement catalogue : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!orgId) return
    loadAll()
  }, [orgId, loadAll])

  // ─── Catégories présentes (pour les chips) ──────────────────────────────
  const allCategories = useMemo(() => {
    const set = new Set()
    for (const it of items) if (it.categorie_suggeree) set.add(it.categorie_suggeree)
    // Fallback vers CATEGORIE_DEFAULTS si catalogue encore vide — aide à
    // ranger dès le premier ajout.
    if (set.size === 0) return CATEGORIE_DEFAULTS.slice()
    return Array.from(set).sort()
  }, [items])

  // ─── Filtrage ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (catFilter !== 'all' && it.categorie_suggeree !== catFilter) return false
      if (!q) return true
      const hay = [
        it.nom,
        it.categorie_suggeree,
        it.sous_categorie_suggeree,
        it.description,
        ...(it.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [items, search, catFilter])

  // Counts par catégorie pour les chips.
  const catCounts = useMemo(() => {
    const counts = { all: items.length }
    for (const it of items) {
      if (!it.categorie_suggeree) continue
      counts[it.categorie_suggeree] = (counts[it.categorie_suggeree] || 0) + 1
    }
    return counts
  }, [items])

  // ─── Handlers ────────────────────────────────────────────────────────────
  function openCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setSlideOpen(true)
  }

  function openEdit(item) {
    setForm({
      nom: item.nom || '',
      categorie_suggeree: item.categorie_suggeree || '',
      sous_categorie_suggeree: item.sous_categorie_suggeree || '',
      description: item.description || '',
      tagsText: (item.tags || []).join(', '),
    })
    setEditingId(item.id)
    setSlideOpen(true)
  }

  function closeSlide() {
    setSlideOpen(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  async function handleSave() {
    if (!orgId) {
      notify.error('Organisation introuvable')
      return
    }
    const nom = form.nom.trim()
    if (!nom) {
      notify.error('Le nom est obligatoire')
      return
    }
    const tags = form.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const payload = {
      nom,
      categorieSuggeree: form.categorie_suggeree.trim() || null,
      sousCategorieSuggeree: form.sous_categorie_suggeree.trim() || null,
      description: form.description.trim() || null,
      tags,
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateMaterielBdd(editingId, {
          nom: payload.nom,
          categorie_suggeree: payload.categorieSuggeree,
          sous_categorie_suggeree: payload.sousCategorieSuggeree,
          description: payload.description,
          tags: payload.tags,
        })
        notify.success('Élément mis à jour')
      } else {
        await createMaterielBdd({ orgId, ...payload })
        notify.success('Élément ajouté au catalogue')
      }
      closeSlide()
      await loadAll()
    } catch (err) {
      notify.error('Erreur enregistrement : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive(item) {
    const ok = await confirm({
      title: `Archiver "${item.nom}" ?`,
      message: 'Il disparaîtra du catalogue actif mais pourra être restauré.',
      confirmLabel: 'Archiver',
      cancelLabel: 'Annuler',
    })
    if (!ok) return
    try {
      await updateMaterielBdd(item.id, { actif: false })
      notify.success('Élément archivé')
      await loadAll()
    } catch (err) {
      notify.error('Erreur archivage : ' + (err?.message || err))
    }
  }

  async function handleRestore(item) {
    try {
      await updateMaterielBdd(item.id, { actif: true })
      notify.success('Élément restauré')
      await loadAll()
    } catch (err) {
      notify.error('Erreur restauration : ' + (err?.message || err))
    }
  }

  // ─── Rendu ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div
          className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Ligne action : bouton + */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
          {items.length} élément{items.length !== 1 ? 's' : ''} actif
          {items.length !== 1 ? 's' : ''}
          {archived.length > 0 && (
            <>
              {' '}· {archived.length} archivé{archived.length !== 1 ? 's' : ''}
            </>
          )}
        </p>
        {!slideOpen && (
          <button type="button" onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nouvel élément matos</span>
          </button>
        )}
      </div>

      {/* Recherche */}
      <div className="relative">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--txt-3)' }}
        />
        <input
          className="input pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par nom, tag, catégorie…"
        />
      </div>

      {/* Chips catégories */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
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

      {/* Grille d'items */}
      {filtered.length === 0 ? (
        <EmptyState
          hasAny={items.length > 0}
          query={search || catFilter !== 'all'}
          onCreate={openCreate}
        />
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onArchive={() => handleArchive(item)}
            />
          ))}
        </div>
      )}

      {/* Section archivés — pliable */}
      {archived.length > 0 && (
        <section className="mt-2">
          <button
            type="button"
            onClick={() => setArchivedExpanded((x) => !x)}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg transition-all"
            style={{ color: 'var(--txt-3)', background: 'var(--bg-surf)' }}
          >
            <ChevronDown
              className="w-3.5 h-3.5 transition-transform"
              style={{ transform: archivedExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            />
            Archivés ({archived.length})
          </button>
          {archivedExpanded && (
            <div
              className="grid gap-3 mt-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
            >
              {archived.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  archived
                  onEdit={() => openEdit(item)}
                  onRestore={() => handleRestore(item)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Slide-over formulaire */}
      {slideOpen && (
        <SlideForm
          form={form}
          setForm={setForm}
          editingId={editingId}
          saving={saving}
          allCategories={allCategories}
          onClose={closeSlide}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Sous-composants
// ═════════════════════════════════════════════════════════════════════════════

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap"
      style={
        active
          ? { background: 'var(--blue-bg)', color: 'var(--blue)' }
          : { background: 'var(--bg-surf)', color: 'var(--txt-3)' }
      }
    >
      <span>{label}</span>
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-full"
        style={{
          background: active ? 'var(--blue)' : 'var(--bg-elev)',
          color: active ? 'white' : 'var(--txt-3)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

function ItemCard({ item, archived = false, onEdit, onArchive, onRestore }) {
  return (
    <article
      className="rounded-xl p-3 flex flex-col gap-2 transition-all group"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        opacity: archived ? 0.65 : 1,
      }}
    >
      {/* Header : nom + actions */}
      <div className="flex items-start gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Package className="w-4 h-4" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <h4
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--txt)' }}
            title={item.nom}
          >
            {item.nom}
          </h4>
          {(item.categorie_suggeree || item.sous_categorie_suggeree) && (
            <p
              className="text-[10px] uppercase tracking-wider mt-0.5 truncate"
              style={{ color: 'var(--txt-3)' }}
            >
              {item.categorie_suggeree}
              {item.sous_categorie_suggeree && (
                <> · {item.sous_categorie_suggeree}</>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            icon={Edit3}
            label="Modifier"
            onClick={onEdit}
          />
          {archived ? (
            <IconButton
              icon={ArchiveRestore}
              label="Restaurer"
              onClick={onRestore}
              color="var(--blue)"
            />
          ) : (
            <IconButton
              icon={Archive}
              label="Archiver"
              onClick={onArchive}
              color="var(--amber)"
            />
          )}
        </div>
      </div>

      {/* Description */}
      {item.description && (
        <p
          className="text-xs line-clamp-2"
          style={{ color: 'var(--txt-2)' }}
        >
          {item.description}
        </p>
      )}

      {/* Tags */}
      {item.tags?.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {item.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
            >
              <Tag className="w-2.5 h-2.5" />
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

function IconButton({ icon: Icon, label, onClick, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md transition-all"
      style={{ color: color || 'var(--txt-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}

function EmptyState({ hasAny, query, onCreate }) {
  if (query) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: 'var(--bg-surf)',
          border: '1px dashed var(--brd)',
          color: 'var(--txt-3)',
        }}
      >
        <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">Aucun résultat</p>
      </div>
    )
  }
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px dashed var(--brd)',
      }}
    >
      <Package
        className="w-10 h-10 mx-auto mb-3 opacity-50"
        style={{ color: 'var(--blue)' }}
      />
      <h4 className="text-sm font-bold mb-1" style={{ color: 'var(--txt)' }}>
        {hasAny ? 'Aucun élément visible' : 'Catalogue matériel vide'}
      </h4>
      <p className="text-xs mb-4" style={{ color: 'var(--txt-3)' }}>
        Ajoute tes références matériel pour les retrouver à chaque projet.
      </p>
      <button type="button" onClick={onCreate} className="btn-primary">
        <Plus className="w-4 h-4" />
        <span>Nouvel élément matos</span>
      </button>
    </div>
  )
}

// ─── Slide-over formulaire ──────────────────────────────────────────────────

function SlideForm({ form, setForm, editingId, saving, allCategories, onClose, onSave }) {
  // Escape pour fermer.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col shadow-2xl"
        style={{
          width: 'min(480px, 100vw)',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--brd)',
        }}
        role="dialog"
        aria-label={editingId ? 'Modifier un élément matos' : 'Nouvel élément matos'}
      >
        {/* Header */}
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <h3 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            {editingId ? 'Modifier' : 'Nouvel élément matos'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-md transition-all"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <FormField label="Nom *" required>
            <input
              className="input"
              value={form.nom}
              onChange={(e) => update('nom', e.target.value)}
              placeholder="ex. RED Komodo 6K"
              autoFocus
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Catégorie">
              <input
                className="input"
                list="matos-bdd-cats"
                value={form.categorie_suggeree}
                onChange={(e) => update('categorie_suggeree', e.target.value)}
                placeholder="ex. Caméra"
              />
              <datalist id="matos-bdd-cats">
                {allCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </FormField>
            <FormField label="Sous-catégorie">
              <input
                className="input"
                value={form.sous_categorie_suggeree}
                onChange={(e) => update('sous_categorie_suggeree', e.target.value)}
                placeholder="ex. Corps caméra"
              />
            </FormField>
          </div>

          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Détails, notes internes, références…"
            />
          </FormField>

          <FormField
            label="Tags"
            hint="Séparés par des virgules · ex. « 6K, super35, global shutter »"
          >
            <input
              className="input"
              value={form.tagsText}
              onChange={(e) => update('tagsText', e.target.value)}
              placeholder="tag1, tag2, tag3"
            />
          </FormField>
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium px-3 py-1.5 rounded-md"
            style={{ color: 'var(--txt-2)' }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !form.nom.trim()}
            className="btn-primary"
            style={{
              opacity: saving || !form.nom.trim() ? 0.5 : 1,
              cursor: saving || !form.nom.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Ajouter'}
          </button>
        </footer>
      </aside>
    </>
  )
}

function FormField({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--txt-3)' }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

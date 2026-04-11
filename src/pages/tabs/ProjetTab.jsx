/**
 * Onglet PROJET — fiche projet structurée en 4 blocs
 * ADMIN / PROJET (champs dynamiques) / LIVRABLES (tableau) / NOTE DE PROD
 */
import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  Save, Eye, EyeOff, Plus, Trash2, GripVertical,
  Check, RefreshCw, ChevronDown, ChevronRight, Building2,
  Clapperboard, FileText, StickyNote
} from 'lucide-react'

// ─── Définition des champs dynamiques PROJET ─────────────────────────────────
// Chaque champ : { key, label, placeholder, group }
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

// ─── Composant principal ──────────────────────────────────────────────────────
export default function ProjetTab() {
  const { project, setProject, projectId } = useOutletContext()

  // Champs ADMIN fixes
  const [admin, setAdmin] = useState({
    title: '', ref_projet: '', bon_commande: '', date_devis: '', client_id: ''
  })

  // Liste clients pour le sélecteur
  const [clientsList, setClientsList] = useState([])

  // Champs PROJET dynamiques (valeurs + visibilité)
  const [fields, setFields]     = useState({})   // { key: value }
  const [visible, setVisible]   = useState({})   // { key: true/false }
  const [showHidden, setShowHidden] = useState(false)

  // Livrables
  const [livrables, setLivrables] = useState([])

  // Note de prod
  const [noteProd, setNoteProd] = useState('')

  // Save state
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const saveTimer = useRef(null)

  // ── Ref "toujours à jour" pour éviter les stale closures dans le timer ──
  const latestState = useRef({})
  latestState.current = { admin, fields, visible, livrables, noteProd }

  // ── Chargement liste clients ──────────────────────────────────────────────
  useEffect(() => {
    supabase.from('clients').select('id, name').order('name')
      .then(({ data }) => setClientsList(data || []))
  }, [])

  // ── Init depuis project ─────────────────────────────────────────────────
  useEffect(() => {
    if (!project) return

    setAdmin({
      title:         project.title         || '',
      ref_projet:    project.ref_projet    || '',
      bon_commande:  project.bon_commande  || '',
      date_devis:    project.date_devis    || '',
      client_id:     project.client_id     || '',
    })

    const meta = project.metadata || {}

    const fv = {}
    fv.type_projet  = meta.type_projet ?? project.type_projet  ?? ''
    fv.agence       = meta.agence      ?? project.agence       ?? ''
    fv.realisateur  = meta.realisateur ?? project.realisateur  ?? ''
    ALL_KEYS.forEach(k => { if (fv[k] === undefined) fv[k] = meta[k] ?? '' })
    setFields(fv)

    const vis = {}
    ALL_KEYS.forEach(k => { vis[k] = meta._visible?.[k] !== false })
    setVisible(vis)

    let livr = []
    try { livr = Array.isArray(project.livrables_json) ? project.livrables_json : JSON.parse(project.livrables_json || '[]') }
    catch { livr = [] }
    if (!livr.length) livr = [EMPTY_LIVRABLE()]
    setLivrables(livr)

    setNoteProd(project.note_prod || '')
  }, [project?.id])

  // ── Auto-save : toujours lire depuis latestState.current ─────────────────
  // Évite le bug "dernière lettre perdue" (stale closure)
  function schedulesSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(doSave, 1200)
  }

  async function doSave() {
    if (!projectId) return
    const { admin, fields, visible, livrables, noteProd } = latestState.current
    setSaving(true)
    try {
      const metadata = { ...fields, _visible: visible }
      const payload = {
        title:          admin.title         || null,
        client_id:      admin.client_id     || null,
        ref_projet:     admin.ref_projet,
        bon_commande:   admin.bon_commande,
        date_devis:     admin.date_devis    || null,
        type_projet:    fields.type_projet  || null,
        agence:         fields.agence       || null,
        realisateur:    fields.realisateur  || null,
        note_prod:      noteProd,
        metadata,
        livrables_json: livrables,
        updated_at:     new Date().toISOString(),
      }
      const { data } = await supabase
        .from('projects').update(payload).eq('id', projectId)
        .select('*, clients(*)').single()
      if (data) setProject(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  // Exposer saveAll pour le bouton manuel
  async function saveAll() { await doSave() }

  const setA = (k, v) => { setAdmin(p => ({ ...p, [k]: v })); schedulesSave() }
  const setF = (k, v) => { setFields(p => ({ ...p, [k]: v })); schedulesSave() }
  const setV = (k)    => { setVisible(p => ({ ...p, [k]: !p[k] })); schedulesSave() }

  const visibleFields  = PROJET_FIELDS_DEF.filter(f => visible[f.key])
  const hiddenFields   = PROJET_FIELDS_DEF.filter(f => !visible[f.key])

  // ── Livrables ─────────────────────────────────────────────────────────────
  function addLivrable() {
    const next = [...livrables, EMPTY_LIVRABLE()]
    setLivrables(next); schedulesSave()
  }
  function updateLivrable(id, key, val) {
    const next = livrables.map(l => l.id === id ? { ...l, [key]: val } : l)
    setLivrables(next); schedulesSave()
  }
  function deleteLivrable(id) {
    const next = livrables.filter(l => l.id !== id)
    setLivrables(next.length ? next : [EMPTY_LIVRABLE()]); schedulesSave()
  }

  if (!project) return null

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-4 pb-16">

      {/* ── Save indicator flottant ────────────────────────────────────── */}
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
        {saving && (
          <div className="flex items-center gap-2 bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs text-gray-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />Sauvegarde…
          </div>
        )}
        {saved && !saving && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 shadow-lg rounded-lg px-3 py-2 text-xs text-green-700">
            <Check className="w-3.5 h-3.5" />Enregistré
          </div>
        )}
        {!saving && !saved && (
          <button
            onClick={saveAll}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-lg rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          >
            <Save className="w-3.5 h-3.5" />Enregistrer
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          BLOC ADMIN
      ══════════════════════════════════════════════════════════════════ */}
      <Block icon={<Building2 className="w-4 h-4" />} title="ADMIN">
        <div className="space-y-4">
          {/* Nom du projet — pleine largeur, en haut */}
          <Field
            label="Nom du projet"
            placeholder="Titre du projet…"
            value={admin.title}
            onChange={v => setA('title', v)}
            big
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Sélecteur client + récap */}
            <div className="space-y-2">
              <div>
                <FieldLabel>Client</FieldLabel>
                <select
                  className="input text-sm"
                  value={admin.client_id || ''}
                  onChange={e => setA('client_id', e.target.value)}
                >
                  <option value="">— Aucun client —</option>
                  {clientsList.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {/* Récap client sélectionné */}
              {project.clients && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 space-y-0.5">
                  {project.clients.address && <p className="text-xs text-gray-500">{project.clients.address}</p>}
                  {project.clients.email   && <p className="text-xs text-gray-400">{project.clients.email}</p>}
                  {project.clients.phone   && <p className="text-xs text-gray-400">{project.clients.phone}</p>}
                  {project.clients.siret   && <p className="text-xs text-gray-400">SIRET : {project.clients.siret}</p>}
                </div>
              )}
            </div>

            {/* Champs admin */}
            <div className="space-y-3">
              <Field label="Réf. projet" placeholder="CAPTIV-2026-001"
                value={admin.ref_projet} onChange={v => setA('ref_projet', v)} />
              <Field label="Bon de commande client" placeholder="N° BC / PO"
                value={admin.bon_commande} onChange={v => setA('bon_commande', v)} />
              <Field label="Date du devis" type="date"
                value={admin.date_devis} onChange={v => setA('date_devis', v)} />
            </div>
          </div>
        </div>
      </Block>

      {/* ══════════════════════════════════════════════════════════════════
          BLOC PROJET
      ══════════════════════════════════════════════════════════════════ */}
      <Block icon={<Clapperboard className="w-4 h-4" />} title="PROJET"
        actions={
          <button
            onClick={() => setShowHidden(p => !p)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 transition-colors"
            title="Afficher/masquer les champs désactivés"
          >
            {showHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {hiddenFields.length > 0 && `${hiddenFields.length} champ${hiddenFields.length > 1 ? 's' : ''} masqué${hiddenFields.length > 1 ? 's' : ''}`}
          </button>
        }
      >
        <FieldSubSection label="Général">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {['type_projet', 'titre_projet'].map(k => renderDynField(k))}
          </div>
        </FieldSubSection>

        <FieldSubSection label="Production">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {['agence', 'production', 'production_executive'].map(k => renderDynField(k))}
          </div>
        </FieldSubSection>

        <FieldSubSection label="Équipe">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {['realisateur', 'producteur'].map(k => renderDynField(k))}
          </div>
        </FieldSubSection>

        <FieldSubSection label="Livrables">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {['nb_livrables', 'duree_master', 'format_master'].map(k => renderDynField(k))}
          </div>
        </FieldSubSection>

        <FieldSubSection label="Planning">
          {/* Prépa : 2 champs côte à côte */}
          <PairedRow
            labelA="Prépa — jours" keyA="prepa_jours" placeholderA="Ex : 2j"
            labelB="Prépa — dates" keyB="prepa_dates" placeholderB="01-02/05/2026"
            fields={fields} visible={visible} setF={setF} setV={setV}
          />
          {/* Tournage : 2 champs côte à côte */}
          <PairedRow
            labelA="Tournage — jours" keyA="tournage_jours" placeholderA="Ex : 3j"
            labelB="Tournage — dates" keyB="tournage_dates" placeholderB="05-07/05/2026"
            fields={fields} visible={visible} setF={setF} setV={setV}
          />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            {['envoi_v1', 'livraison_master', 'deadline'].map(k => renderDynField(k))}
          </div>
        </FieldSubSection>

        {/* Champs masqués (affichés seulement si showHidden) */}
        {showHidden && hiddenFields.length > 0 && (
          <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
            <p className="text-xs text-gray-400 mb-3">Champs masqués — cliquer sur 👁 pour réactiver</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {hiddenFields.map(f => (
                <div key={f.key} className="flex items-center justify-between bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400">{f.label}</span>
                  <button onClick={() => setV(f.key)} className="text-gray-300 hover:text-blue-500 transition-colors ml-2">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Block>

      {/* ══════════════════════════════════════════════════════════════════
          BLOC LIVRABLES
      ══════════════════════════════════════════════════════════════════ */}
      <Block icon={<FileText className="w-4 h-4" />} title="LIVRABLES"
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
              {livrables.map((l, i) => (
                <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                  <td className="py-1.5 px-2 text-xs text-gray-400 font-mono">{i + 1}</td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-sm"
                      value={l.nom} onChange={e => updateLivrable(l.id, 'nom', e.target.value)}
                      placeholder="Film 3 min 16/9…"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-xs"
                      value={l.format} onChange={e => updateLivrable(l.id, 'format', e.target.value)}
                      placeholder="MP4, MOV…"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-xs"
                      value={l.duree} onChange={e => updateLivrable(l.id, 'duree', e.target.value)}
                      placeholder="3'00&quot;"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-xs"
                      value={l.livraison} onChange={e => updateLivrable(l.id, 'livraison', e.target.value)}
                      placeholder="01/06/2026"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <button
                      onClick={() => deleteLivrable(l.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      {/* ══════════════════════════════════════════════════════════════════
          BLOC NOTE DE PROD
      ══════════════════════════════════════════════════════════════════ */}
      <Block icon={<StickyNote className="w-4 h-4" />} title="NOTE DE PROD">
        <textarea
          className="w-full text-sm text-gray-700 bg-amber-50/60 border border-amber-100 rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-amber-300 focus:border-amber-300 placeholder-amber-300"
          rows={6}
          placeholder="Informations hors devis, contraintes techniques, budget hors-champ, remarques de production…"
          value={noteProd}
          onChange={e => { setNoteProd(e.target.value); schedulesSave() }}
        />
      </Block>

    </div>
  )

  // ── Rendu d'un champ dynamique ──────────────────────────────────────────
  function renderDynField(key) {
    const def = PROJET_FIELDS_DEF.find(f => f.key === key)
    if (!def) return null
    if (!visible[key]) return null  // masqué

    return (
      <div key={key} className="relative group/field">
        <Field
          label={def.label}
          placeholder={def.placeholder}
          value={fields[key] || ''}
          onChange={v => setF(key, v)}
        />
        {/* Bouton masquer au hover */}
        <button
          onClick={() => setV(key)}
          className="absolute top-0 right-0 opacity-0 group-hover/field:opacity-100 transition-opacity text-gray-300 hover:text-red-400 p-0.5"
          title="Masquer ce champ"
        >
          <EyeOff className="w-3 h-3" />
        </button>
      </div>
    )
  }
}

// ─── Composants utilitaires ───────────────────────────────────────────────────
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

function FieldGroup({ label, children }) {
  const arr = Array.isArray(children) ? children : [children]
  const validChildren = arr.filter(Boolean)
  if (!validChildren.length) return null
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2 ml-0.5">{label}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {validChildren}
      </div>
    </div>
  )
}

// Sous-section avec titre plus visible (pour Livrables/Planning dans le bloc PROJET)
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

// Ligne double : deux champs côte à côte avec masquage indépendant
function PairedRow({ labelA, keyA, placeholderA, labelB, keyB, placeholderB, fields, visible, setF, setV }) {
  const hiddenA = visible[keyA] === false
  const hiddenB = visible[keyB] === false
  if (hiddenA && hiddenB) return null
  return (
    <div className="grid grid-cols-2 gap-3 mb-3">
      {!hiddenA ? (
        <div className="relative group/field">
          <label className="text-xs font-medium text-gray-500 block mb-1.5">{labelA}</label>
          <input
            className="input text-sm"
            value={fields[keyA] || ''}
            onChange={e => setF(keyA, e.target.value)}
            placeholder={placeholderA}
          />
          <button onClick={() => setV(keyA)}
            className="absolute top-0 right-0 opacity-0 group-hover/field:opacity-100 transition-opacity text-gray-300 hover:text-red-400 p-0.5"
            title="Masquer">
            <EyeOff className="w-3 h-3" />
          </button>
        </div>
      ) : <div />}
      {!hiddenB ? (
        <div className="relative group/field">
          <label className="text-xs font-medium text-gray-500 block mb-1.5">{labelB}</label>
          <input
            className="input text-sm"
            value={fields[keyB] || ''}
            onChange={e => setF(keyB, e.target.value)}
            placeholder={placeholderB}
          />
          <button onClick={() => setV(keyB)}
            className="absolute top-0 right-0 opacity-0 group-hover/field:opacity-100 transition-opacity text-gray-300 hover:text-red-400 p-0.5"
            title="Masquer">
            <EyeOff className="w-3 h-3" />
          </button>
        </div>
      ) : <div />}
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

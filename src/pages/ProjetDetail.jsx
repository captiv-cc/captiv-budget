import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { calcSynthese, fmtEur, fmtPct, TAUX_DEFAUT, TYPES_PROJET } from '../lib/cotisations'
import {
  ChevronLeft, Plus, Eye, Trash2, TrendingUp, Euro,
  BarChart2, FileText, Edit2, Check, X, Save
} from 'lucide-react'

const STATUS_OPTIONS = [
  { value:'prospect',  label:'Prospect',  cls:'badge-amber' },
  { value:'en_cours',  label:'En cours',  cls:'badge-blue'  },
  { value:'termine',   label:'Terminé',   cls:'badge-green' },
  { value:'annule',    label:'Annulé',    cls:'badge-gray'  },
]

export default function ProjetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { org, profile, canSeeFinance } = useAuth()

  const [project, setProject]     = useState(null)
  const [devisList, setDevisList] = useState([])
  const [devisStats, setDevisStats] = useState({})
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState(false)
  const [form, setForm]           = useState({})

  useEffect(() => { loadAll() }, [id])

  async function loadAll() {
    setLoading(true)
    const { data: proj } = await supabase
      .from('projects').select('*, clients(*)').eq('id', id).single()
    setProject(proj)
    setForm(proj || {})

    const { data: dvs } = await supabase
      .from('devis').select('*').eq('project_id', id).order('version_number')
    setDevisList(dvs || [])

    if (dvs?.length) {
      const { data: lines } = await supabase
        .from('devis_lines').select('*').in('devis_id', dvs.map(d => d.id))
      const stats = {}
      for (const dv of dvs) {
        const dvLines = (lines || []).filter(l => l.devis_id === dv.id)
        stats[dv.id] = calcSynthese(
          dvLines, dv.tva_rate || 20, dv.acompte_pct || 30, TAUX_DEFAUT,
          { marge_globale_pct: dv.marge_globale_pct, assurance_pct: dv.assurance_pct,
            remise_globale_pct: dv.remise_globale_pct, remise_globale_montant: dv.remise_globale_montant }
        )
      }
      setDevisStats(stats)
    }
    setLoading(false)
  }

  async function saveProject() {
    const payload = {
      title: form.title, description: form.description, status: form.status,
      client_id: form.client_id || null,
      date_debut: form.date_debut || null, date_fin: form.date_fin || null,
      ref_projet: form.ref_projet, date_devis: form.date_devis || null,
      bon_commande: form.bon_commande, type_projet: form.type_projet,
      agence: form.agence, realisateur: form.realisateur,
      note_prod: form.note_prod, livrables: form.livrables,
      updated_at: new Date().toISOString(),
    }
    const { data } = await supabase.from('projects').update(payload).eq('id', id).select('*, clients(*)').single()
    if (data) { setProject(data); setForm(data) }
    setEditing(false)
  }

  async function createDevis() {
    const nextVer = (devisList[devisList.length - 1]?.version_number || 0) + 1
    const { data } = await supabase.from('devis')
      .insert({ project_id: id, version_number: nextVer, title: project?.title, status: 'brouillon', created_by: profile?.id })
      .select().single()
    if (data) {
      for (let i = 0; i < 4; i++) {
        await supabase.from('devis_categories').insert({
          devis_id: data.id,
          name: ['PRODUCTION','TECHNIQUE','POSTPRODUCTION','LOGISTIQUE'][i],
          sort_order: i
        })
      }
      navigate(`/projets/${id}/devis/${data.id}`)
    }
  }

  async function deleteDevis(dvId) {
    if (!canSeeFinance) return
    if (!confirm('Supprimer ce devis ?')) return
    await supabase.from('devis').delete().eq('id', dvId)
    setDevisList(p => p.filter(d => d.id !== dvId))
  }

  async function updateDevisStatus(dvId, status) {
    await supabase.from('devis').update({ status }).eq('id', dvId)
    setDevisList(p => p.map(d => d.id === dvId ? { ...d, status } : d))
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Chargement…</div>

  const refDevis = devisList.find(d => d.status === 'accepte') || devisList[devisList.length - 1]
  const globalSynth = refDevis ? devisStats[refDevis.id] : null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-5">
        <Link to="/projets" className="hover:text-blue-600 flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" />Projets
        </Link>
        <span>›</span>
        <span className="text-gray-900 font-medium">{project?.title}</span>
      </div>

      {/* ── Fiche projet ───────────────────────────────────────────────────── */}
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="font-semibold text-sm text-gray-800">Fiche projet</h2>
          <div className="flex items-center gap-2">
            <Link to={`/projets/${id}/budget`} className="btn-secondary btn-sm">
              <BarChart2 className="w-3.5 h-3.5" />Budget réel
            </Link>
            {editing ? (
              <>
                <button onClick={() => { setEditing(false); setForm(project) }} className="btn-secondary btn-sm">
                  <X className="w-3.5 h-3.5" />Annuler
                </button>
                <button onClick={saveProject} className="btn-primary btn-sm">
                  <Save className="w-3.5 h-3.5" />Enregistrer
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
                <Edit2 className="w-3.5 h-3.5" />Modifier
              </button>
            )}
          </div>
        </div>

        <div className="p-5">
          {editing ? (
            <EditForm form={form} setForm={setForm} />
          ) : (
            <ViewForm project={project} />
          )}
        </div>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      {globalSynth && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <KpiCard color="blue"   label="CA devisé HT"       value={fmtEur(globalSynth.totalHTFinal)} />
          <KpiCard color="green"  label="Marge finale"        value={fmtPct(globalSynth.pctMargeFinale)} sub={fmtEur(globalSynth.margeFinale)} />
          <KpiCard color="purple" label="Charges sociales"    value={fmtEur(globalSynth.totalCharges)} />
          <KpiCard color="amber"  label="Part interne"        value={fmtPct(globalSynth.pctInterne)} sub={fmtEur(globalSynth.totalInterne)} />
        </div>
      )}

      {/* ── Devis ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-sm text-gray-800">Devis</h2>
          <button onClick={createDevis} className="btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" />Nouveau devis
          </button>
        </div>

        {devisList.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Aucun devis pour l'instant</p>
            <button onClick={createDevis} className="btn-primary btn-sm mt-4">Créer le premier devis</button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {devisList.map(dv => {
              const s = devisStats[dv.id]
              return (
                <div key={dv.id} className="flex items-center px-5 py-3.5 hover:bg-gray-50 group">
                  <Link to={`/projets/${id}/devis/${dv.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                      <span className="text-blue-600 text-sm font-bold">V{dv.version_number}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{dv.title || `Devis V${dv.version_number}`}</p>
                      <p className="text-xs text-gray-400">{new Date(dv.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                  </Link>
                  {s && (
                    <div className="hidden md:flex items-center gap-6 mr-4">
                      <div className="text-right">
                        <p className="text-xs text-gray-400">Total HT</p>
                        <p className="text-sm font-semibold">{fmtEur(s.totalHTFinal)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400">Marge</p>
                        <p className={`text-sm font-semibold ${s.pctMargeFinale > 0.2 ? 'text-green-600' : s.pctMargeFinale < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                          {fmtPct(s.pctMargeFinale)}
                        </p>
                      </div>
                    </div>
                  )}
                  <select
                    value={dv.status}
                    onChange={e => updateDevisStatus(dv.id, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    className="text-xs border border-gray-200 rounded-md px-2 py-1 mr-2 bg-white cursor-pointer focus:outline-none focus:border-blue-400"
                  >
                    <option value="brouillon">Brouillon</option>
                    <option value="envoye">Envoyé</option>
                    <option value="accepte">Accepté</option>
                    <option value="refuse">Refusé</option>
                  </select>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link to={`/projets/${id}/devis/${dv.id}`} className="btn-ghost btn-sm text-xs">
                      <Eye className="w-3.5 h-3.5" />Ouvrir
                    </Link>
                    {canSeeFinance && (
                      <button onClick={() => deleteDevis(dv.id)} className="btn-ghost btn-sm text-gray-400 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Vue lecture ───────────────────────────────────────────────────────────────
function ViewForm({ project: p }) {
  if (!p) return null
  const fields = [
    ['Réf. projet',     p.ref_projet],
    ['Type',            p.type_projet],
    ['Réalisateur',     p.realisateur],
    ['Agence',          p.agence],
    ['Client',          p.clients?.name],
    ['Statut',          STATUS_OPTIONS.find(s => s.value === p.status)?.label],
    ['Date devis',      p.date_devis ? new Date(p.date_devis).toLocaleDateString('fr-FR') : null],
    ['Bon de commande', p.bon_commande],
    ['Date début',      p.date_debut ? new Date(p.date_debut).toLocaleDateString('fr-FR') : null],
    ['Date fin',        p.date_fin   ? new Date(p.date_fin).toLocaleDateString('fr-FR')   : null],
  ]

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">{p.title}</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2 mb-4">
        {fields.filter(([, v]) => v).map(([label, val]) => (
          <div key={label}>
            <span className="text-xs text-gray-400">{label}</span>
            <p className="text-sm font-medium text-gray-900">{val}</p>
          </div>
        ))}
      </div>
      {p.description && <p className="text-sm text-gray-600 mb-3">{p.description}</p>}
      {p.note_prod && (
        <div className="p-3 bg-amber-50 rounded-lg mb-3">
          <p className="text-xs font-semibold text-amber-700 mb-1">Note de prod / Hors devis</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{p.note_prod}</p>
        </div>
      )}
      {p.livrables && (
        <div className="p-3 bg-blue-50 rounded-lg">
          <p className="text-xs font-semibold text-blue-700 mb-1">Livrables</p>
          <p className="text-sm text-blue-900 whitespace-pre-wrap">{p.livrables}</p>
        </div>
      )}
    </div>
  )
}

// ── Formulaire édition ────────────────────────────────────────────────────────
function EditForm({ form, setForm }) {
  const f = (field, val) => setForm(p => ({ ...p, [field]: val }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="col-span-2 md:col-span-3">
          <label className="label">Titre du projet *</label>
          <input className="input" value={form.title || ''} onChange={e => f('title', e.target.value)} required />
        </div>
        <div>
          <label className="label">Réf. projet</label>
          <input className="input" value={form.ref_projet || ''} onChange={e => f('ref_projet', e.target.value)} placeholder="CAPTIV-2026-001" />
        </div>
        <div>
          <label className="label">Type de projet</label>
          <select className="input" value={form.type_projet || ''} onChange={e => f('type_projet', e.target.value)}>
            <option value="">— Choisir —</option>
            {TYPES_PROJET.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Statut</label>
          <select className="input" value={form.status || 'prospect'} onChange={e => f('status', e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Réalisateur</label>
          <input className="input" value={form.realisateur || ''} onChange={e => f('realisateur', e.target.value)} placeholder="Nom du réalisateur" />
        </div>
        <div>
          <label className="label">Agence</label>
          <input className="input" value={form.agence || ''} onChange={e => f('agence', e.target.value)} placeholder="Nom de l'agence" />
        </div>
        <div>
          <label className="label">Bon de commande client</label>
          <input className="input" value={form.bon_commande || ''} onChange={e => f('bon_commande', e.target.value)} placeholder="N° BC" />
        </div>
        <div>
          <label className="label">Date du devis</label>
          <input type="date" className="input" value={form.date_devis || ''} onChange={e => f('date_devis', e.target.value)} />
        </div>
        <div>
          <label className="label">Date début tournage</label>
          <input type="date" className="input" value={form.date_debut || ''} onChange={e => f('date_debut', e.target.value)} />
        </div>
        <div>
          <label className="label">Date fin</label>
          <input type="date" className="input" value={form.date_fin || ''} onChange={e => f('date_fin', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input resize-none h-16" value={form.description || ''} onChange={e => f('description', e.target.value)} />
      </div>
      <div>
        <label className="label">Note de prod / Hors devis</label>
        <textarea className="input resize-none h-20" value={form.note_prod || ''}
          onChange={e => f('note_prod', e.target.value)}
          placeholder="Informations hors devis, notes de production, contraintes particulières…" />
      </div>
      <div>
        <label className="label">Liste des livrables</label>
        <textarea className="input resize-none h-20" value={form.livrables || ''}
          onChange={e => f('livrables', e.target.value)}
          placeholder="1 film de 3 min format 16/9&#10;1 version 1 min pour réseaux sociaux&#10;Fichiers sources…" />
      </div>
    </div>
  )
}

function KpiCard({ color, label, value, sub }) {
  const clrs = { blue:'bg-blue-50 text-blue-700', green:'bg-green-50 text-green-700', purple:'bg-purple-50 text-purple-700', amber:'bg-amber-50 text-amber-700' }
  return (
    <div className={`rounded-xl p-4 ${clrs[color]}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}

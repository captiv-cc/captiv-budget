import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcSynthese, fmtEur, fmtPct, TAUX_DEFAUT } from '../lib/cotisations'
import { AlertTriangle, Check, ChevronLeft, Plus, Trash2 } from 'lucide-react'

export default function BudgetReel() {
  const { id: projectId } = useParams()
  const [project, setProject] = useState(null)
  const [devisRef, setDevisRef] = useState(null) // devis accepté de référence
  const [synthDevis, setSynthDevis] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    fournisseur: '',
    description: '',
    montant_ht: '',
    regime: 'Externe',
    facture_ref: '',
    categorie: '',
  })

  const loadAll = useCallback(async () => {
    setLoading(true)
    const { data: proj } = await supabase
      .from('projects')
      .select('*, clients(nom_commercial)')
      .eq('id', projectId)
      .single()
    setProject(proj)

    // Devis de référence = dernier accepté ou dernier brouillon
    const { data: dvs } = await supabase
      .from('devis')
      .select('*')
      .eq('project_id', projectId)
      .order('version_number', { ascending: false })
    const ref = dvs?.find((d) => d.status === 'accepte') || dvs?.[0]
    setDevisRef(ref)

    if (ref) {
      const { data: lines } = await supabase.from('devis_lines').select('*').eq('devis_id', ref.id)
      setSynthDevis(
        calcSynthese(lines || [], ref.tva_rate || 20, ref.acompte_pct || 30, TAUX_DEFAUT),
      )
    }

    const { data: ents } = await supabase
      .from('budget_reel')
      .select('*')
      .eq('project_id', projectId)
      .order('date')
    setEntries(ents || [])
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    loadAll()
  }, [loadAll, projectId])

  async function addEntry(e) {
    e.preventDefault()
    const { data } = await supabase
      .from('budget_reel')
      .insert({ ...form, project_id: projectId, montant_ht: parseFloat(form.montant_ht) || 0 })
      .select()
      .single()
    if (data) {
      setEntries((p) => [...p, data])
      setShowForm(false)
      setForm((f) => ({ ...f, fournisseur: '', description: '', montant_ht: '', facture_ref: '' }))
    }
  }

  async function deleteEntry(id) {
    await supabase.from('budget_reel').delete().eq('id', id)
    setEntries((p) => p.filter((e) => e.id !== id))
  }

  const totalReel = entries.reduce((s, e) => s + (e.montant_ht || 0), 0)
  const ecart = (synthDevis?.totalPrixVente || 0) - totalReel
  const ecartPct = synthDevis?.totalPrixVente ? ecart / synthDevis.totalPrixVente : 0

  if (loading) return <div className="p-8 text-sm text-gray-400">Chargement…</div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-5">
        <Link to={`/projets/${projectId}`} className="hover:text-blue-600 flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" /> {project?.title}
        </Link>
        <span>›</span>
        <span className="text-gray-900 font-medium">Budget réel</span>
      </div>

      {/* Comparatif */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <p className="text-xs text-gray-500 mb-1">
            Budget devisé HT {devisRef ? `(V${devisRef.version_number})` : ''}
          </p>
          <p className="text-xl font-bold text-blue-600">
            {fmtEur(synthDevis?.totalPrixVente || 0)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {devisRef?.status === 'accepte' ? '✅ Accepté' : '⚠️ Ref. provisoire'}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-gray-500 mb-1">Dépenses réelles HT</p>
          <p
            className={`text-xl font-bold ${totalReel > (synthDevis?.totalPrixVente || 0) ? 'text-red-600' : 'text-gray-900'}`}
          >
            {fmtEur(totalReel)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{entries.length} entrées</p>
        </div>
        <div
          className={`card p-5 ${ecart < 0 ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'}`}
        >
          <p className="text-xs text-gray-500 mb-1">Écart</p>
          <div className="flex items-center gap-2">
            {ecart < 0 ? (
              <AlertTriangle className="w-5 h-5 text-red-500" />
            ) : (
              <Check className="w-5 h-5 text-green-600" />
            )}
            <p className={`text-xl font-bold ${ecart < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {ecart < 0 ? '−' : '+'}
              {fmtEur(Math.abs(ecart))}
            </p>
          </div>
          <p className={`text-xs mt-0.5 ${ecart < 0 ? 'text-red-500' : 'text-green-600'}`}>
            {fmtPct(Math.abs(ecartPct))} {ecart < 0 ? 'de dépassement' : 'en dessous'}
          </p>
        </div>
      </div>

      {/* Formulaire ajout */}
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="font-semibold text-gray-800 text-sm">Dépenses réelles</h2>
          <button onClick={() => setShowForm((p) => !p)} className="btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>

        {showForm && (
          <div className="p-5 bg-gray-50 border-b border-gray-100">
            <form onSubmit={addEntry} className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  className="input"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Fournisseur</label>
                <input
                  className="input"
                  value={form.fournisseur}
                  onChange={(e) => setForm((f) => ({ ...f, fournisseur: e.target.value }))}
                  placeholder="Nom fournisseur"
                />
              </div>
              <div className="col-span-2">
                <label className="label">Description *</label>
                <input
                  className="input"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Prestation, matériel…"
                  required
                />
              </div>
              <div>
                <label className="label">Montant HT (€) *</label>
                <input
                  type="number"
                  className="input"
                  value={form.montant_ht}
                  onChange={(e) => setForm((f) => ({ ...f, montant_ht: e.target.value }))}
                  placeholder="0.00"
                  required
                  min={0}
                  step={0.01}
                />
              </div>
              <div>
                <label className="label">Catégorie</label>
                <input
                  className="input"
                  value={form.categorie}
                  onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value }))}
                  placeholder="PRODUCTION, TECH…"
                />
              </div>
              <div>
                <label className="label">N° Facture</label>
                <input
                  className="input"
                  value={form.facture_ref}
                  onChange={(e) => setForm((f) => ({ ...f, facture_ref: e.target.value }))}
                  placeholder="FAC-2026-001"
                />
              </div>
              <div className="flex items-end gap-2">
                <button type="submit" className="btn-primary flex-1">
                  Ajouter
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                  ✕
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tableau dépenses */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left">Date</th>
                <th className="px-4 py-2.5 text-left">Description</th>
                <th className="px-4 py-2.5 text-left">Fournisseur</th>
                <th className="px-4 py-2.5 text-left">Catégorie</th>
                <th className="px-4 py-2.5 text-left">N° Facture</th>
                <th className="px-4 py-2.5 text-right">Montant HT</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                    Aucune dépense enregistrée
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50 group">
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {new Date(e.date).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{e.description}</td>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">{e.fournisseur || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="badge badge-gray text-xs">{e.categorie || '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{e.facture_ref || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{fmtEur(e.montant_ht)}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => deleteEntry(e.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length > 0 && (
                <tr className="font-bold bg-gray-50">
                  <td
                    colSpan={5}
                    className="px-4 py-2.5 text-right text-xs uppercase text-gray-500"
                  >
                    Total réel HT
                  </td>
                  <td className="px-4 py-2.5 text-right text-blue-700">{fmtEur(totalReel)}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

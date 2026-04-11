/**
 * Vue publique du devis — accessible via /devis/public/:token
 * Partageable avec le client : ne montre PAS les coûts ni les marges
 */
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcLine, calcSynthese, fmtEur, TAUX_DEFAUT } from '../lib/cotisations'
import { Film, Check, X } from 'lucide-react'

export default function DevisPublic() {
  const { token } = useParams()
  const [devis, setDevis]     = useState(null)
  const [project, setProject] = useState(null)
  const [client, setClient]   = useState(null)
  const [org, setOrg]         = useState(null)
  const [categories, setCategories] = useState([])
  const [synth, setSynth]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => { load() }, [token])

  async function load() {
    const { data: dv } = await supabase
      .from('devis').select('*').eq('public_token', token).single()

    if (!dv) { setNotFound(true); setLoading(false); return }
    setDevis(dv)

    const [{ data: proj }, { data: cats }, { data: lines }] = await Promise.all([
      supabase.from('projects').select('*, clients(*), organisations(*)').eq('id', dv.project_id).single(),
      supabase.from('devis_categories').select('*').eq('devis_id', dv.id).order('sort_order'),
      supabase.from('devis_lines').select('*').eq('devis_id', dv.id).order('sort_order'),
    ])

    setProject(proj)
    setClient(proj?.clients)
    setOrg(proj?.organisations)

    const catsWithLines = (cats || []).map(cat => ({
      ...cat,
      lines: (lines || []).filter(l => l.category_id === cat.id && l.use_line && l.produit?.trim())
    })).filter(c => c.lines.length > 0)

    setCategories(catsWithLines)
    setSynth(calcSynthese(lines || [], dv.tva_rate || 20, dv.acompte_pct || 30, TAUX_DEFAUT))
    setAccepted(dv.status === 'accepte')
    setLoading(false)
  }

  async function handleAccept() {
    await supabase.from('devis').update({ status: 'accepte' }).eq('id', devis.id)
    setAccepted(true)
    setDevis(d => ({ ...d, status: 'accepte' }))
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (notFound) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-center p-8">
      <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-4">
        <X className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-xl font-bold text-gray-900 mb-2">Devis introuvable</h1>
      <p className="text-gray-500 text-sm">Ce lien est invalide ou a expiré.</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <Film className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">{org?.name || 'CAPTIV'}</p>
              <p className="text-xs text-gray-400">Devis V{devis?.version_number}</p>
            </div>
          </div>
          {accepted ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              <Check className="w-4 h-4" /> Devis accepté
            </div>
          ) : (
            <button onClick={handleAccept} className="btn-primary">
              <Check className="w-4 h-4" /> Accepter ce devis
            </button>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Info devis */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Émis par</p>
            <p className="font-bold text-gray-900">{org?.name || 'CAPTIV'}</p>
            {org?.address && <p className="text-sm text-gray-500 mt-0.5">{org.address}</p>}
            {org?.email && <p className="text-sm text-gray-500">{org.email}</p>}
            {org?.siret && <p className="text-xs text-gray-400 mt-1">SIRET : {org.siret}</p>}
          </div>
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-3">À l'attention de</p>
            <p className="font-bold text-gray-900">{client?.name || '—'}</p>
            {client?.contact_name && <p className="text-sm text-gray-500">{client.contact_name}</p>}
            {client?.email && <p className="text-sm text-gray-500">{client.email}</p>}
          </div>
        </div>

        <div className="card p-5 mb-6">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-gray-400">Projet</p>
              <p className="font-semibold text-gray-900">{project?.title}</p>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            <div>
              <p className="text-xs text-gray-400">Version</p>
              <p className="font-semibold text-gray-900">V{devis?.version_number}</p>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            <div>
              <p className="text-xs text-gray-400">Date</p>
              <p className="font-semibold text-gray-900">{new Date(devis?.created_at).toLocaleDateString('fr-FR')}</p>
            </div>
          </div>
        </div>

        {/* Lignes (sans coûts ni marges) */}
        <div className="card overflow-hidden mb-6">
          {categories.map(cat => (
            <div key={cat.id}>
              <div className="px-4 py-2 bg-slate-800 text-white text-xs font-bold uppercase tracking-wider">
                {cat.name}
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2 text-left">Désignation</th>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-right w-16">Qté</th>
                    <th className="px-4 py-2 text-center w-12">U</th>
                    <th className="px-4 py-2 text-right w-28">Prix unit. HT</th>
                    <th className="px-4 py-2 text-right w-28">Total HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cat.lines.map(line => {
                    const c = calcLine(line, TAUX_DEFAUT)
                    return (
                      <tr key={line.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-sm">{line.produit}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-500">{line.description}</td>
                        <td className="px-4 py-2.5 text-right text-sm">{line.quantite}</td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-400">{line.unite}</td>
                        <td className="px-4 py-2.5 text-right text-sm">{fmtEur(line.tarif_ht)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-sm">{fmtEur(c.prixVenteHT)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* Synthèse */}
        <div className="flex justify-end">
          <div className="w-72 card p-5 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total HT</span>
              <span className="font-semibold">{fmtEur(synth?.totalPrixVente)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">TVA {devis?.tva_rate || 20}%</span>
              <span>{fmtEur(synth?.tva)}</span>
            </div>
            <div className="border-t border-gray-200 my-2" />
            <div className="flex justify-between items-center py-2 px-3 bg-blue-600 rounded-lg text-white">
              <span className="font-bold text-sm">TOTAL TTC</span>
              <span className="font-bold text-lg">{fmtEur(synth?.totalTTC)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>Acompte {devis?.acompte_pct || 30}%</span>
              <span>{fmtEur(synth?.acompte)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>Solde à réception</span>
              <span>{fmtEur(synth?.solde)}</span>
            </div>
          </div>
        </div>

        {devis?.notes && (
          <div className="mt-6 card p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Notes & Conditions</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{devis.notes}</p>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-8">
          Document généré par CAPTIV Budget · {org?.name || ''} · {org?.siret ? 'SIRET ' + org.siret : ''}
        </p>
      </div>
    </div>
  )
}

/**
 * Onglet DEVIS — liste des versions + éditeur inline
 */
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { fmtEur, fmtPct } from '../../lib/cotisations'
import DevisEditor from '../DevisEditor'
import {
  Plus, Eye, Trash2, FileText, CheckCircle2, Clock, Send, XCircle,
  LayoutTemplate, ChevronDown
} from 'lucide-react'
import { BLOCS_CANONIQUES } from '../DevisEditor'

const STATUS_MAP = {
  brouillon: { label: 'Brouillon', icon: Clock,        cls: 'text-gray-500 bg-gray-100' },
  envoye:    { label: 'Envoyé',    icon: Send,         cls: 'text-blue-600 bg-blue-50'  },
  accepte:   { label: 'Accepté',   icon: CheckCircle2, cls: 'text-green-600 bg-green-50'},
  refuse:    { label: 'Refusé',    icon: XCircle,      cls: 'text-red-500 bg-red-50'    },
}

export default function DevisTab() {
  const { devisId, id: projectId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { devisList, setDevisList, devisStats, project, reload } = useOutletContext()

  // TODO (templates) : charger la liste des templates dispo
  // const [templates, setTemplates] = useState([])
  // const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  // useEffect(() => {
  //   supabase.from('devis_templates').select('*').order('sort_order')
  //     .then(({ data }) => setTemplates(data || []))
  // }, [])

  // Si un devisId est dans l'URL → afficher l'éditeur en plein écran (dans l'onglet)
  if (devisId) {
    return (
      <div className="flex-1 overflow-hidden flex flex-col h-full">
        <DevisEditor embedded />
      </div>
    )
  }

  // ── Liste des versions ────────────────────────────────────────────────────
  // ── Création d'un devis (vierge ou depuis un template) ──────────────────
  // templateId : uuid du template à copier, null = devis vierge
  async function createDevis(templateId = null) {
    const nextVer = (devisList[devisList.length - 1]?.version_number || 0) + 1
    const { data: newDevis, error: devisErr } = await supabase.from('devis')
      .insert({
        project_id:     projectId,
        version_number: nextVer,
        title:          project?.title,
        status:         'brouillon',
        created_by:     profile?.id,
      })
      .select().single()

    if (devisErr) { console.error('[createDevis]', devisErr); return }
    if (!newDevis) return

    if (templateId) {
      // ── Copie depuis un template ─────────────────────────────────────────
      const { data: tplCats } = await supabase
        .from('template_categories')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order')

      for (const tplCat of (tplCats || [])) {
        const { data: newCat } = await supabase.from('devis_categories')
          .insert({ devis_id: newDevis.id, name: tplCat.name, sort_order: tplCat.sort_order })
          .select().single()

        if (newCat) {
          const { data: tplLines } = await supabase
            .from('template_lines')
            .select('*')
            .eq('category_id', tplCat.id)
            .order('sort_order')

          if (tplLines?.length) {
            await supabase.from('devis_lines').insert(
              tplLines.map(l => ({
                devis_id:       newDevis.id,
                category_id:    newCat.id,
                ref:            l.ref,
                produit:        l.produit,
                description:    l.description,
                regime:         l.regime,
                use_line:       l.use_line,
                interne:        l.interne,
                cout_egal_vente: l.cout_egal_vente,
                dans_marge:     l.dans_marge,
                quantite:       l.quantite,
                unite:          l.unite,
                tarif_ht:       l.tarif_ht,
                cout_ht:        l.cout_ht,
                remise_pct:     l.remise_pct,
                sort_order:     l.sort_order,
              }))
            )
          }
        }
      }
    } else {
      // ── Devis vierge : 7 blocs canoniques dans l'ordre ───────────────────
      for (let i = 0; i < BLOCS_CANONIQUES.length; i++) {
        await supabase.from('devis_categories').insert({
          devis_id:   newDevis.id,
          name:       BLOCS_CANONIQUES[i].key,
          sort_order: i * 10,
          dans_marge: true,
        })
      }
    }

    setDevisList(p => [...p, newDevis])
    navigate(`/projets/${projectId}/devis/${newDevis.id}`)
  }

  async function deleteDevis(dvId, e) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Supprimer ce devis et toutes ses lignes ?')) return
    await supabase.from('devis').delete().eq('id', dvId)
    setDevisList(p => p.filter(d => d.id !== dvId))
  }

  async function updateStatus(dvId, status, e) {
    e.stopPropagation()
    await supabase.from('devis').update({ status }).eq('id', dvId)
    setDevisList(p => p.map(d => d.id === dvId ? { ...d, status } : d))
    reload()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="font-semibold text-sm text-gray-800">Versions du devis</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {devisList.length === 0
                ? 'Aucune version'
                : `${devisList.length} version${devisList.length > 1 ? 's' : ''}`}
            </p>
          </div>
          {/* TODO (templates) : remplacer ce bouton par un menu déroulant
              qui propose "Devis vierge" + la liste des templates disponibles.
              Pour l'instant : crée toujours un devis vierge. */}
          <div className="flex items-center gap-1">
            <button onClick={() => createDevis(null)} className="btn-primary btn-sm">
              <Plus className="w-3.5 h-3.5" />
              Nouveau devis
            </button>
            {/* Bouton templates (désactivé visuellement jusqu'à l'implémentation) */}
            <button
              title="Créer depuis un template — disponible prochainement"
              className="btn-secondary btn-sm opacity-50 cursor-not-allowed"
              onClick={() => alert('Fonctionnalité templates à venir !')}
            >
              <LayoutTemplate className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {devisList.length === 0 ? (
          <div className="p-16 text-center">
            <FileText className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500 font-medium mb-1">Aucun devis pour ce projet</p>
            <p className="text-gray-400 text-xs mb-5">Créez la première version pour commencer</p>
            <button onClick={() => createDevis(null)} className="btn-primary btn-sm">
              <Plus className="w-3.5 h-3.5" /> Créer V1
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {[...devisList].reverse().map(dv => {
              const s      = devisStats[dv.id]
              const status = STATUS_MAP[dv.status] || STATUS_MAP.brouillon
              const StatusIcon = status.icon
              const isRef  = dv.status === 'accepte'

              return (
                <Link
                  key={dv.id}
                  to={`/projets/${projectId}/devis/${dv.id}`}
                  className="flex items-center px-5 py-4 hover:bg-gray-50 group transition-colors"
                >
                  {/* Version badge */}
                  <div className={`
                    w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mr-4 font-bold text-sm
                    ${isRef ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'}
                  `}>
                    V{dv.version_number}
                  </div>

                  {/* Infos devis */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">
                        {dv.title || `Devis V${dv.version_number}`}
                      </span>
                      {isRef && (
                        <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold">
                          Référence
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Créé le {new Date(dv.created_at).toLocaleDateString('fr-FR')}
                      {dv.updated_at && dv.updated_at !== dv.created_at &&
                        ` · Modifié ${new Date(dv.updated_at).toLocaleDateString('fr-FR')}`}
                    </p>
                  </div>

                  {/* Montants */}
                  {s && (
                    <div className="hidden md:flex items-center gap-8 mr-6">
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total HT</p>
                        <p className="text-sm font-bold text-gray-900">{fmtEur(s.totalHTFinal)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Marge</p>
                        <p className={`text-sm font-bold ${
                          s.pctMargeFinale > 0.2 ? 'text-green-600' :
                          s.pctMargeFinale < 0   ? 'text-red-600'   : 'text-amber-600'
                        }`}>
                          {fmtPct(s.pctMargeFinale)}
                        </p>
                        <p className="text-[10px] text-gray-400">{fmtEur(s.margeFinale)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">TTC</p>
                        <p className="text-sm font-semibold text-gray-700">{fmtEur(s.totalTTC)}</p>
                      </div>
                    </div>
                  )}

                  {/* Statut */}
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.preventDefault()}>
                    <select
                      value={dv.status}
                      onChange={e => updateStatus(dv.id, e.target.value, e)}
                      className={`
                        text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 cursor-pointer
                        focus:outline-none focus:border-blue-400 font-medium
                        ${STATUS_MAP[dv.status]?.cls || ''}
                      `}
                    >
                      {Object.entries(STATUS_MAP).map(([val, { label }]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="btn-ghost btn-sm text-xs text-gray-400">
                        <Eye className="w-3.5 h-3.5" />
                      </span>
                      <button
                        onClick={e => deleteDevis(dv.id, e)}
                        className="btn-ghost btn-sm text-gray-300 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

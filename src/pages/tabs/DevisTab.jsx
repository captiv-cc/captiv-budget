/**
 * Onglet DEVIS — liste des versions + éditeur inline
 */
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { fmtEur, fmtPct } from '../../lib/cotisations'
import DevisEditor from '../DevisEditor'
import ProjectAvatar from '../../features/projets/components/ProjectAvatar'
import {
  Plus, Copy, Pencil, Trash2, FileText,
  LayoutTemplate, Sparkles, TrendingUp, Layers, Star,
} from 'lucide-react'
import { BLOCS_CANONIQUES } from '../DevisEditor'

const STATUS_MAP = {
  brouillon: { label: 'Brouillon', cls: 'text-gray-500 bg-gray-100' },
  envoye:    { label: 'Envoyé',    cls: 'text-blue-600 bg-blue-50'  },
  accepte:   { label: 'Accepté',   cls: 'text-green-600 bg-green-50'},
  refuse:    { label: 'Refusé',    cls: 'text-red-500 bg-red-50'    },
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

  // ── Duplique un devis (copie complète : devis + cats + lines + membres) ──
  async function duplicateDevis(srcDv, e) {
    e.preventDefault()
    e.stopPropagation()

    // 1. On récupère le devis source en entier (pour avoir tous les champs
    //    globaux : marge, assurance, remise, tva, acompte, notes…)
    const { data: srcFull } = await supabase
      .from('devis')
      .select('*')
      .eq('id', srcDv.id)
      .single()

    if (!srcFull) { console.error('[duplicateDevis] source introuvable'); return }

    const nextVer = (devisList[devisList.length - 1]?.version_number || 0) + 1
    const { data: newDevis, error: devisErr } = await supabase.from('devis')
      .insert({
        project_id:             projectId,
        version_number:         nextVer,
        title:                  srcFull.title,
        status:                 'brouillon',
        created_by:             profile?.id,
        // ── Champs globaux qu'on doit reporter ────────────────────────────
        tva_rate:               srcFull.tva_rate,
        acompte_pct:            srcFull.acompte_pct,
        notes:                  srcFull.notes,
        marge_globale_pct:      srcFull.marge_globale_pct,
        assurance_pct:          srcFull.assurance_pct,
        remise_globale_pct:     srcFull.remise_globale_pct,
        remise_globale_montant: srcFull.remise_globale_montant,
      })
      .select().single()

    if (devisErr) { console.error('[duplicateDevis]', devisErr); return }
    if (!newDevis) return

    // 2. Catégories (avec notes)
    const { data: srcCats } = await supabase
      .from('devis_categories')
      .select('*')
      .eq('devis_id', srcDv.id)
      .order('sort_order')

    // Map old_line_id → new_line_id pour rebrancher les membres ensuite
    const lineIdMap = new Map()

    for (const srcCat of (srcCats || [])) {
      const { data: newCat } = await supabase.from('devis_categories')
        .insert({
          devis_id:   newDevis.id,
          name:       srcCat.name,
          sort_order: srcCat.sort_order,
          dans_marge: srcCat.dans_marge,
          notes:      srcCat.notes,
        })
        .select().single()

      if (!newCat) continue

      // 3. Lignes de la catégorie — insertion 1-par-1 pour récupérer le mapping
      const { data: srcLines } = await supabase
        .from('devis_lines')
        .select('*')
        .eq('category_id', srcCat.id)
        .order('sort_order')

      for (const l of (srcLines || [])) {
        const { data: newLine } = await supabase.from('devis_lines')
          .insert({
            devis_id:        newDevis.id,
            category_id:     newCat.id,
            ref:             l.ref,
            produit:         l.produit,
            description:     l.description,
            regime:          l.regime,
            use_line:        l.use_line,
            interne:         l.interne,
            cout_egal_vente: l.cout_egal_vente,
            dans_marge:      l.dans_marge,
            nb:              l.nb,           // ← oublié avant (= "nombre")
            quantite:        l.quantite,
            unite:           l.unite,
            tarif_ht:        l.tarif_ht,
            cout_ht:         l.cout_ht,
            remise_pct:      l.remise_pct,
            sort_order:      l.sort_order,
            is_crew:         l.is_crew,      // ← oublié avant
          })
          .select().single()

        if (newLine) lineIdMap.set(l.id, newLine.id)
      }
    }

    // 4. Affectation des équipes : on copie devis_ligne_membres en remappant
    //    les line_id vers leurs équivalents dans le nouveau devis
    if (lineIdMap.size > 0) {
      const { data: srcMembres } = await supabase
        .from('devis_ligne_membres')
        .select('devis_line_id, projet_membre_id, notes')
        .in('devis_line_id', Array.from(lineIdMap.keys()))

      if (srcMembres?.length) {
        await supabase.from('devis_ligne_membres').insert(
          srcMembres
            .map(m => ({
              devis_line_id:    lineIdMap.get(m.devis_line_id),
              projet_membre_id: m.projet_membre_id,
              notes:            m.notes,
            }))
            .filter(m => m.devis_line_id) // sécurité
        )
      }
    }

    setDevisList(p => [...p, newDevis])
    navigate(`/projets/${projectId}/devis/${newDevis.id}`)
  }

  // ── Renommer un devis (titre libre genre "V2 — Sans tournage J2") ───────
  async function renameDevis(dv, e) {
    e.preventDefault()
    e.stopPropagation()
    const next = prompt(
      'Nom de cette version (vide pour réinitialiser) :',
      dv.title || '',
    )
    if (next === null) return // annulé
    const newTitle = next.trim() || null
    const { error } = await supabase.from('devis')
      .update({ title: newTitle })
      .eq('id', dv.id)
    if (error) { console.error('[renameDevis]', error); return }
    setDevisList(p => p.map(d => d.id === dv.id ? { ...d, title: newTitle } : d))
  }

  async function updateStatus(dvId, status, e) {
    e.stopPropagation()
    await supabase.from('devis').update({ status }).eq('id', dvId)
    setDevisList(p => p.map(d => d.id === dvId ? { ...d, status } : d))
    reload()
  }

  // ─── KPI synthèse ─────────────────────────────────────────────────────────
  // Le devis "de référence" est celui accepté ; sinon le plus récent en
  // brouillon / envoyé (= dernier en date). Les KPI s'appuient dessus.
  const refDevis = devisList.find(d => d.status === 'accepte')
                   || devisList[devisList.length - 1]
  const refStats = refDevis ? devisStats[refDevis.id] : null

  const margeTone =
    !refStats                      ? 'text-gray-400'
    : refStats.pctMargeFinale > 0.2 ? 'text-green-600'
    : refStats.pctMargeFinale < 0   ? 'text-red-600'
    :                                 'text-amber-600'

  return (
    <div className="p-5 max-w-5xl mx-auto pb-16 space-y-4">

      {/* ── HEADER PROJET — rappel contextuel + CTA principal ─────────────── */}
      <div className="card overflow-visible">
        <div className="p-4 sm:p-5 flex items-center gap-4">
          <ProjectAvatar project={project} size={52} rounded="lg" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
              Devis du projet
            </p>
            <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
              {project?.title || 'Projet sans nom'}
            </h1>
            {project?.clients?.name && (
              <p className="text-xs text-gray-500 truncate mt-0.5">{project.clients.name}</p>
            )}
          </div>
          {devisList.length > 0 && (
            // TODO (templates) : transformer en split-button (▾) ou en menu déroulant
            //   "Nouveau devis vierge" / "Depuis un template…" quand la feature
            //   sera dispo. Garder le clic principal = devis vierge pour ne pas
            //   perturber le flow actuel.
            <button onClick={() => createDevis(null)} className="btn-primary btn-sm shrink-0">
              <Plus className="w-3.5 h-3.5" />
              Nouveau devis
            </button>
          )}
        </div>
      </div>

      {/* ── KPI SYNTHÈSE (si au moins un devis) ───────────────────────────── */}
      {devisList.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={<Layers className="w-3.5 h-3.5 text-blue-500" />}
            label="Versions"
            value={devisList.length}
            sub={`${devisList.length > 1 ? 'itérations' : 'itération'}`}
          />
          <KpiCard
            icon={<Star className="w-3.5 h-3.5 text-amber-500" />}
            label="Référence"
            value={refDevis ? `V${refDevis.version_number}` : '—'}
            sub={refDevis ? (STATUS_MAP[refDevis.status]?.label || refDevis.status) : '—'}
          />
          <KpiCard
            icon={<FileText className="w-3.5 h-3.5 text-gray-500" />}
            label="Total HT"
            value={refStats ? fmtEur(refStats.totalHTFinal) : '—'}
            sub={refStats ? `${fmtEur(refStats.totalTTC)} TTC` : null}
          />
          <KpiCard
            icon={<TrendingUp className="w-3.5 h-3.5 text-green-500" />}
            label="Marge"
            value={refStats ? fmtPct(refStats.pctMargeFinale) : '—'}
            valueClass={margeTone}
            sub={refStats ? fmtEur(refStats.margeFinale) : null}
          />
        </div>
      )}

      {/* ── EMPTY STATE — aucun devis encore créé ─────────────────────────── */}
      {devisList.length === 0 ? (
        <>
          <div className="card overflow-hidden">
            <div className="p-10 sm:p-14 text-center">
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                <FileText className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1.5">
                Aucun devis pour ce projet
              </h3>
              <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6">
                Lancez-vous en créant votre première version, vierge ou
                pré-remplie depuis l'un de vos templates.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button onClick={() => createDevis(null)} className="btn-primary">
                  <Plus className="w-4 h-4" />
                  Créer un devis vierge
                </button>
                <button
                  disabled
                  className="btn-secondary opacity-60 cursor-not-allowed"
                  title="Disponible prochainement"
                >
                  <LayoutTemplate className="w-4 h-4" />
                  Depuis un template
                  <span className="ml-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    Bientôt
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Teaser templates — visible même sans devis */}
          <TemplatesTeaser />
        </>
      ) : (
        // ── LISTE DES VERSIONS ─────────────────────────────────────────────
        <>
          <div className="card overflow-hidden">
            <div className="card-header">
              <div>
                <h2 className="font-semibold text-sm text-gray-800">Versions</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {devisList.length} version{devisList.length > 1 ? 's' : ''} — la plus récente en haut
                </p>
              </div>
            </div>

            <div className="divide-y divide-gray-50">
              {[...devisList].reverse().map(dv => {
                const s      = devisStats[dv.id]
                const isRef  = dv.status === 'accepte'

                const rowMargeTone =
                  !s                       ? 'text-gray-400'
                  : s.pctMargeFinale > 0.2 ? 'text-green-600'
                  : s.pctMargeFinale < 0   ? 'text-red-600'
                  :                          'text-amber-600'

                return (
                  <Link
                    key={dv.id}
                    to={`/projets/${projectId}/devis/${dv.id}`}
                    className="flex items-center gap-4 px-4 sm:px-5 py-3.5 hover:bg-blue-50/30 group transition-colors relative"
                  >
                    {/* Liseré vert sur le devis de référence */}
                    {isRef && (
                      <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-green-500" />
                    )}

                    {/* Version badge */}
                    <div className={`
                      w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm
                      ring-1 ring-inset
                      ${isRef
                        ? 'bg-green-50 text-green-700 ring-green-200'
                        : 'bg-blue-50 text-blue-600 ring-blue-100'}
                    `}>
                      V{dv.version_number}
                    </div>

                    {/* Infos devis */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate">
                          {dv.title || `Devis V${dv.version_number}`}
                        </span>
                        {isRef && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold uppercase tracking-wider">
                            <Star className="w-2.5 h-2.5 fill-current" />
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

                    {/* Montants — masqués sous md pour respirer */}
                    {s && (
                      <div className="hidden md:flex items-center gap-6 lg:gap-8">
                        <div className="text-right">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">HT</p>
                          <p className="text-sm font-bold text-gray-900 tabular-nums">
                            {fmtEur(s.totalHTFinal)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Marge</p>
                          <p className={`text-sm font-bold tabular-nums ${rowMargeTone}`}>
                            {fmtPct(s.pctMargeFinale)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Statut + actions */}
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.preventDefault()}>
                      <select
                        value={dv.status}
                        onChange={e => updateStatus(dv.id, e.target.value, e)}
                        className={`
                          text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 cursor-pointer
                          focus:outline-none focus:border-blue-400 font-semibold
                          ${STATUS_MAP[dv.status]?.cls || ''}
                        `}
                      >
                        {Object.entries(STATUS_MAP).map(([val, { label }]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>

                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={e => renameDevis(dv, e)}
                          title="Renommer cette version"
                          className="btn-ghost btn-sm text-gray-400 hover:text-gray-700"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => duplicateDevis(dv, e)}
                          title="Dupliquer ce devis"
                          className="btn-ghost btn-sm text-gray-400 hover:text-blue-600"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => deleteDevis(dv.id, e)}
                          title="Supprimer ce devis"
                          className="btn-ghost btn-sm text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Teaser templates — discret en bas */}
          <TemplatesTeaser compact />
        </>
      )}
    </div>
  )
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, valueClass = 'text-gray-900' }) {
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

// Teaser pour la fonctionnalité "templates de devis" qui arrive bientôt.
// Compact = format réduit pour l'afficher discrètement en bas de page.
function TemplatesTeaser({ compact = false }) {
  return (
    <div className={`card overflow-hidden border-dashed ${compact ? '' : 'mt-1'}`}>
      <div className={`flex items-center gap-3 ${compact ? 'p-3.5' : 'p-4 sm:p-5'}`}>
        <div className={`shrink-0 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm ${compact ? 'w-9 h-9' : 'w-11 h-11'}`}>
          <Sparkles className={`text-white ${compact ? 'w-4 h-4' : 'w-5 h-5'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`font-semibold text-gray-900 ${compact ? 'text-xs' : 'text-sm'}`}>
              Templates de devis
            </h3>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
              Bientôt
            </span>
          </div>
          <p className={`text-gray-500 mt-0.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
            Gagnez du temps en pré-remplissant vos devis depuis vos modèles favoris (Captation Live, Pub, Corporate…).
          </p>
        </div>
      </div>
    </div>
  )
}

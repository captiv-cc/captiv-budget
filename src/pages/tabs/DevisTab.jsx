/**
 * Onglet DEVIS — vue par lot (accordéon)
 *
 * Hiérarchie :
 *   Projet
 *     └── Lots (contrats commerciaux indépendants : "Aftermovie", "Social media", …)
 *            └── Versions de devis (V1, V2, V3… indépendantes par lot)
 *
 * Le statut d'un lot est DÉRIVÉ des statuts de ses devis (voir lib/lots.js).
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'
import { fmtEur, fmtPct } from '../../lib/cotisations'
import { LOT_STATUS } from '../../lib/lots'
import DevisEditor, { BLOCS_CANONIQUES } from '../DevisEditor'
import ProjectAvatar from '../../features/projets/components/ProjectAvatar'
import {
  Plus,
  Copy,
  Pencil,
  Trash2,
  FileText,
  LayoutTemplate,
  Sparkles,
  TrendingUp,
  Layers,
  Star,
  Package,
  ChevronDown,
  ChevronRight,
  Archive,
  ArchiveRestore,
  MoreVertical,
} from 'lucide-react'

const STATUS_MAP = {
  brouillon: { label: 'Brouillon', cls: 'text-gray-500 bg-gray-100' },
  envoye: { label: 'Envoyé', cls: 'text-blue-600 bg-blue-50' },
  accepte: { label: 'Accepté', cls: 'text-green-600 bg-green-50' },
  refuse: { label: 'Refusé', cls: 'text-red-500 bg-red-50' },
}

export default function DevisTab() {
  const { devisId, id: projectId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const {
    lots,
    setLots,
    devisByLot,
    refDevisByLot,
    refSynthByLot,
    lotStatusMap,
    devisList,
    setDevisList,
    devisStats,
    project,
    reload,
  } = useOutletContext()

  // ⚠️ Tous les hooks DOIVENT être déclarés AVANT tout return conditionnel —
  // sinon on risque « Rendered fewer hooks than expected » quand la navigation
  // transite du listing vers l'éditeur plein écran (devisId dans l'URL).

  // ── Recharge les stats quand on sort de l'éditeur vers la liste ───────────
  // Sinon les montants affichés dans la liste restent ceux du dernier load et
  // l'utilisateur doit F5 après une modif.
  const prevDevisIdRef = useRef(devisId)
  useEffect(() => {
    if (prevDevisIdRef.current && !devisId) {
      reload()
    }
    prevDevisIdRef.current = devisId
  }, [devisId, reload])

  // ── État local : accordéon déplié/replié par lot (persisté) ────────────────
  const storageKey = `captiv.devisLotsExpanded.${projectId}`
  const [expandedLots, setExpandedLots] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  // Init : par défaut tous les lots non archivés sont dépliés
  useEffect(() => {
    if (expandedLots === null && lots.length) {
      const initial = {}
      for (const lot of lots) if (!lot.archived) initial[lot.id] = true
      setExpandedLots(initial)
    }
  }, [lots, expandedLots])

  // Persistance
  useEffect(() => {
    if (expandedLots !== null) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(expandedLots))
      } catch {
        /* quota ou mode privé : on ignore */
      }
    }
  }, [expandedLots, storageKey])

  const isExpanded = (lotId) => (expandedLots || {})[lotId] === true
  const toggleLot = (lotId) =>
    setExpandedLots((prev) => ({ ...(prev || {}), [lotId]: !(prev || {})[lotId] }))

  // ── Partitions : lots actifs / archivés ────────────────────────────────────
  const activeLots = useMemo(() => lots.filter((l) => !l.archived), [lots])
  const archivedLots = useMemo(() => lots.filter((l) => l.archived), [lots])
  const [showArchived, setShowArchived] = useState(false)

  // ── KPI agrégés sur tous les lots actifs ───────────────────────────────────
  const globalStats = useMemo(() => {
    let totalHT = 0
    let totalTTC = 0
    let marge = 0
    let lotsWithRef = 0
    for (const lot of activeLots) {
      const s = refSynthByLot[lot.id]
      if (s) {
        totalHT += s.totalHTFinal || 0
        totalTTC += s.totalTTC || 0
        marge += s.margeFinale || 0
        lotsWithRef++
      }
    }
    return {
      totalHT,
      totalTTC,
      marge,
      pctMarge: totalHT ? marge / totalHT : 0,
      lotsWithRef,
    }
  }, [activeLots, refSynthByLot])

  const totalVersions = devisList.length
  const margeTone = !globalStats.lotsWithRef
    ? 'text-gray-400'
    : globalStats.pctMarge > 0.2
      ? 'text-green-600'
      : globalStats.pctMarge < 0
        ? 'text-red-600'
        : 'text-amber-600'

  // ─────────────────────────────────────────────────────────────────────────
  // Actions LOT
  // ─────────────────────────────────────────────────────────────────────────
  async function createLot(defaultTitle = '') {
    const title = prompt(
      'Nom du lot (ex : "Aftermovie", "Vidéos réseaux sociaux") :',
      defaultTitle,
    )
    if (title === null) return
    const clean = title.trim()
    if (!clean) return
    const maxOrder = lots.reduce((m, l) => Math.max(m, l.sort_order || 0), 0)
    const { data, error } = await supabase
      .from('devis_lots')
      .insert({
        project_id: projectId,
        title: clean,
        sort_order: maxOrder + 10,
      })
      .select()
      .single()
    if (error) {
      console.error('[createLot]', error)
      notify.error('Impossible de créer le lot : ' + error.message)
      return null
    }
    setLots((p) => [...p, data])
    setExpandedLots((prev) => ({ ...(prev || {}), [data.id]: true }))
    return data
  }

  async function renameLot(lot, e) {
    e?.stopPropagation()
    const next = prompt('Nom du lot :', lot.title || '')
    if (next === null) return
    const clean = next.trim()
    if (!clean || clean === lot.title) return
    const { error } = await supabase
      .from('devis_lots')
      .update({ title: clean })
      .eq('id', lot.id)
    if (error) {
      console.error('[renameLot]', error)
      notify.error('Impossible de renommer le lot')
      return
    }
    setLots((p) => p.map((l) => (l.id === lot.id ? { ...l, title: clean } : l)))
  }

  async function toggleArchiveLot(lot, e) {
    e?.stopPropagation()
    const next = !lot.archived
    if (next && !confirm(`Archiver le lot "${lot.title}" ? Son contenu reste accessible en lecture.`))
      return
    const { error } = await supabase
      .from('devis_lots')
      .update({ archived: next })
      .eq('id', lot.id)
    if (error) {
      console.error('[toggleArchiveLot]', error)
      notify.error('Impossible de modifier le lot')
      return
    }
    setLots((p) => p.map((l) => (l.id === lot.id ? { ...l, archived: next } : l)))
  }

  async function deleteLot(lot, e) {
    e?.stopPropagation()
    const lotDevis = devisByLot[lot.id] || []
    if (lotDevis.length) {
      notify.error(
        `Impossible : ${lotDevis.length} devis sont rattachés à ce lot. Supprimez-les d'abord.`,
      )
      return
    }
    if (!confirm(`Supprimer définitivement le lot "${lot.title}" ?`)) return
    const { error } = await supabase.from('devis_lots').delete().eq('id', lot.id)
    if (error) {
      console.error('[deleteLot]', error)
      notify.error('Impossible de supprimer le lot : ' + error.message)
      return
    }
    setLots((p) => p.filter((l) => l.id !== lot.id))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions DEVIS (toujours scopées à un lot)
  // ─────────────────────────────────────────────────────────────────────────
  async function createDevis(lotId, templateId = null) {
    // Si aucun lot n'existe encore, on en crée un premier ("Principal")
    let targetLotId = lotId
    if (!targetLotId) {
      const newLot = await createLot('Principal')
      if (!newLot) return
      targetLotId = newLot.id
    }

    const lotDevis = devisByLot[targetLotId] || []
    const nextVer = lotDevis.reduce((m, d) => Math.max(m, d.version_number || 0), 0) + 1

    const { data: newDevis, error: devisErr } = await supabase
      .from('devis')
      .insert({
        project_id: projectId,
        lot_id: targetLotId,
        version_number: nextVer,
        title: project?.title,
        status: 'brouillon',
        created_by: profile?.id,
      })
      .select()
      .single()

    if (devisErr) {
      console.error('[createDevis]', devisErr)
      notify.error('Impossible de créer le devis : ' + devisErr.message)
      return
    }
    if (!newDevis) return

    if (templateId) {
      const { data: tplCats } = await supabase
        .from('template_categories')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order')

      for (const tplCat of tplCats || []) {
        const { data: newCat } = await supabase
          .from('devis_categories')
          .insert({ devis_id: newDevis.id, name: tplCat.name, sort_order: tplCat.sort_order })
          .select()
          .single()

        if (newCat) {
          const { data: tplLines } = await supabase
            .from('template_lines')
            .select('*')
            .eq('category_id', tplCat.id)
            .order('sort_order')

          if (tplLines?.length) {
            await supabase.from('devis_lines').insert(
              tplLines.map((l) => ({
                devis_id: newDevis.id,
                category_id: newCat.id,
                ref: l.ref,
                produit: l.produit,
                description: l.description,
                regime: l.regime,
                use_line: l.use_line,
                interne: l.interne,
                cout_egal_vente: l.cout_egal_vente,
                dans_marge: l.dans_marge,
                quantite: l.quantite,
                unite: l.unite,
                tarif_ht: l.tarif_ht,
                cout_ht: l.cout_ht,
                remise_pct: l.remise_pct,
                sort_order: l.sort_order,
              })),
            )
          }
        }
      }
    } else {
      // Devis vierge : 7 blocs canoniques
      for (let i = 0; i < BLOCS_CANONIQUES.length; i++) {
        await supabase.from('devis_categories').insert({
          devis_id: newDevis.id,
          name: BLOCS_CANONIQUES[i].key,
          sort_order: i * 10,
          dans_marge: true,
        })
      }
    }

    setDevisList((p) => [...p, newDevis])
    navigate(`/projets/${projectId}/devis/${newDevis.id}`)
  }

  async function deleteDevis(dvId, e) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Supprimer ce devis et toutes ses lignes ?')) return
    const { error } = await supabase.from('devis').delete().eq('id', dvId)
    if (error) {
      console.error('[deleteDevis]', error)
      notify.error('Impossible de supprimer le devis')
      return
    }
    setDevisList((p) => p.filter((d) => d.id !== dvId))
  }

  async function duplicateDevis(srcDv, e) {
    e.preventDefault()
    e.stopPropagation()

    const { data: srcFull } = await supabase.from('devis').select('*').eq('id', srcDv.id).single()
    if (!srcFull) {
      notify.error('Devis source introuvable')
      return
    }

    // Nouvelle version = MAX du lot + 1 (pas globale)
    const lotDevis = devisByLot[srcFull.lot_id] || []
    const nextVer = lotDevis.reduce((m, d) => Math.max(m, d.version_number || 0), 0) + 1

    const { data: newDevis, error: devisErr } = await supabase
      .from('devis')
      .insert({
        project_id: projectId,
        lot_id: srcFull.lot_id,
        version_number: nextVer,
        title: srcFull.title,
        status: 'brouillon',
        created_by: profile?.id,
        tva_rate: srcFull.tva_rate,
        acompte_pct: srcFull.acompte_pct,
        notes: srcFull.notes,
        marge_globale_pct: srcFull.marge_globale_pct,
        assurance_pct: srcFull.assurance_pct,
        remise_globale_pct: srcFull.remise_globale_pct,
        remise_globale_montant: srcFull.remise_globale_montant,
      })
      .select()
      .single()

    if (devisErr) {
      console.error('[duplicateDevis]', devisErr)
      notify.error('Impossible de dupliquer le devis : ' + devisErr.message)
      return
    }
    if (!newDevis) return

    const { data: srcCats } = await supabase
      .from('devis_categories')
      .select('*')
      .eq('devis_id', srcDv.id)
      .order('sort_order')

    const lineIdMap = new Map()

    for (const srcCat of srcCats || []) {
      const { data: newCat } = await supabase
        .from('devis_categories')
        .insert({
          devis_id: newDevis.id,
          name: srcCat.name,
          sort_order: srcCat.sort_order,
          dans_marge: srcCat.dans_marge,
          notes: srcCat.notes,
        })
        .select()
        .single()

      if (!newCat) continue

      const { data: srcLines } = await supabase
        .from('devis_lines')
        .select('*')
        .eq('category_id', srcCat.id)
        .order('sort_order')

      for (const l of srcLines || []) {
        const { data: newLine } = await supabase
          .from('devis_lines')
          .insert({
            devis_id: newDevis.id,
            category_id: newCat.id,
            ref: l.ref,
            produit: l.produit,
            description: l.description,
            regime: l.regime,
            use_line: l.use_line,
            interne: l.interne,
            cout_egal_vente: l.cout_egal_vente,
            dans_marge: l.dans_marge,
            nb: l.nb,
            quantite: l.quantite,
            unite: l.unite,
            tarif_ht: l.tarif_ht,
            cout_ht: l.cout_ht,
            remise_pct: l.remise_pct,
            sort_order: l.sort_order,
            is_crew: l.is_crew,
          })
          .select()
          .single()

        if (newLine) lineIdMap.set(l.id, newLine.id)
      }
    }

    if (lineIdMap.size > 0) {
      const { data: srcMembres } = await supabase
        .from('devis_ligne_membres')
        .select('devis_line_id, projet_membre_id, notes')
        .in('devis_line_id', Array.from(lineIdMap.keys()))

      if (srcMembres?.length) {
        await supabase.from('devis_ligne_membres').insert(
          srcMembres
            .map((m) => ({
              devis_line_id: lineIdMap.get(m.devis_line_id),
              projet_membre_id: m.projet_membre_id,
              notes: m.notes,
            }))
            .filter((m) => m.devis_line_id),
        )
      }
    }

    setDevisList((p) => [...p, newDevis])
    navigate(`/projets/${projectId}/devis/${newDevis.id}`)
  }

  async function renameDevis(dv, e) {
    e.preventDefault()
    e.stopPropagation()
    const next = prompt('Nom de cette version (vide pour réinitialiser) :', dv.title || '')
    if (next === null) return
    const newTitle = next.trim() || null
    const { error } = await supabase.from('devis').update({ title: newTitle }).eq('id', dv.id)
    if (error) {
      console.error('[renameDevis]', error)
      notify.error('Impossible de renommer le devis')
      return
    }
    setDevisList((p) => p.map((d) => (d.id === dv.id ? { ...d, title: newTitle } : d)))
  }

  async function updateStatus(dvId, status, e) {
    e.stopPropagation()
    await supabase.from('devis').update({ status }).eq('id', dvId)
    setDevisList((p) => p.map((d) => (d.id === dvId ? { ...d, status } : d)))
    reload()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendu
  // ─────────────────────────────────────────────────────────────────────────

  // Si un devisId est dans l'URL → afficher l'éditeur en plein écran.
  // Ce return DOIT venir après tous les hooks (useState/useMemo/useEffect)
  // pour garantir que le nombre de hooks appelés reste stable entre les
  // rendus (sinon : « Rendered fewer hooks than expected »).
  if (devisId) {
    return (
      <div className="flex-1 overflow-hidden flex flex-col h-full">
        <DevisEditor embedded />
      </div>
    )
  }

  const hasAnyLot = lots.length > 0
  const hasAnyDevis = devisList.length > 0

  return (
    <div className="p-5 max-w-5xl mx-auto pb-16 space-y-4">
      {/* ── HEADER PROJET ───────────────────────────────────────────────── */}
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
            {project?.clients?.nom_commercial && (
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {project.clients.nom_commercial}
              </p>
            )}
          </div>
          {hasAnyLot && (
            <button onClick={() => createLot('')} className="btn-secondary btn-sm shrink-0">
              <Package className="w-3.5 h-3.5" />
              Nouveau lot
            </button>
          )}
        </div>
      </div>

      {/* ── KPI SYNTHÈSE ──────────────────────────────────────────────────── */}
      {hasAnyDevis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={<Package className="w-3.5 h-3.5 text-indigo-500" />}
            label="Lots actifs"
            value={activeLots.length}
            sub={archivedLots.length ? `${archivedLots.length} archivé(s)` : null}
          />
          <KpiCard
            icon={<Layers className="w-3.5 h-3.5 text-blue-500" />}
            label="Versions"
            value={totalVersions}
            sub={totalVersions > 1 ? 'toutes lots confondus' : null}
          />
          <KpiCard
            icon={<FileText className="w-3.5 h-3.5 text-gray-500" />}
            label="Total HT (ref.)"
            value={globalStats.lotsWithRef ? fmtEur(globalStats.totalHT) : '—'}
            sub={
              globalStats.lotsWithRef
                ? `${fmtEur(globalStats.totalTTC)} TTC · ${globalStats.lotsWithRef} lot${globalStats.lotsWithRef > 1 ? 's' : ''}`
                : null
            }
          />
          <KpiCard
            icon={<TrendingUp className="w-3.5 h-3.5 text-green-500" />}
            label="Marge moyenne"
            value={globalStats.lotsWithRef ? fmtPct(globalStats.pctMarge) : '—'}
            valueClass={margeTone}
            sub={globalStats.lotsWithRef ? fmtEur(globalStats.marge) : null}
          />
        </div>
      )}

      {/* ── EMPTY STATE — aucun lot encore ────────────────────────────────── */}
      {!hasAnyLot ? (
        <>
          <div className="card overflow-hidden">
            <div className="p-10 sm:p-14 text-center">
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                <FileText className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1.5">
                Aucun devis pour ce projet
              </h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
                Lancez-vous en créant votre premier devis. Un lot «&nbsp;Principal&nbsp;» sera créé
                automatiquement. Vous pourrez ajouter d&apos;autres lots plus tard (ex :
                «&nbsp;Aftermovie&nbsp;», «&nbsp;Vidéos réseaux sociaux&nbsp;»).
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button onClick={() => createDevis(null, null)} className="btn-primary">
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
          <TemplatesTeaser />
        </>
      ) : (
        // ── LISTE DES LOTS (accordéon) ───────────────────────────────────
        <>
          <div className="space-y-3">
            {activeLots.map((lot) => (
              <LotAccordion
                key={lot.id}
                lot={lot}
                devis={devisByLot[lot.id] || []}
                refDevis={refDevisByLot[lot.id]}
                refSynth={refSynthByLot[lot.id]}
                status={lotStatusMap[lot.id]}
                expanded={isExpanded(lot.id)}
                onToggle={() => toggleLot(lot.id)}
                onRename={(e) => renameLot(lot, e)}
                onArchive={(e) => toggleArchiveLot(lot, e)}
                onDelete={(e) => deleteLot(lot, e)}
                onCreateDevis={() => createDevis(lot.id, null)}
                onOpenDevis={(dv) => navigate(`/projets/${projectId}/devis/${dv.id}`)}
                onDuplicateDevis={duplicateDevis}
                onDeleteDevis={deleteDevis}
                onRenameDevis={renameDevis}
                onUpdateStatus={updateStatus}
                devisStats={devisStats}
                projectId={projectId}
              />
            ))}
          </div>

          {/* Bouton global "+ Nouveau lot" en bas si plusieurs lots */}
          {activeLots.length > 0 && (
            <div className="flex items-center justify-center pt-1">
              <button onClick={() => createLot('')} className="btn-ghost btn-sm text-gray-500">
                <Plus className="w-3.5 h-3.5" />
                Ajouter un lot
              </button>
            </div>
          )}

          {/* ── Lots archivés ─────────────────────────────────────────── */}
          {archivedLots.length > 0 && (
            <div className="card overflow-hidden">
              <button
                onClick={() => setShowArchived((p) => !p)}
                className="w-full px-4 py-3 flex items-center gap-2 hover:bg-gray-50 transition-colors"
              >
                {showArchived ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
                <Archive className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {archivedLots.length} lot{archivedLots.length > 1 ? 's' : ''} archivé
                  {archivedLots.length > 1 ? 's' : ''}
                </span>
              </button>
              {showArchived && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {archivedLots.map((lot) => (
                    <LotAccordion
                      key={lot.id}
                      lot={lot}
                      devis={devisByLot[lot.id] || []}
                      refDevis={refDevisByLot[lot.id]}
                      refSynth={refSynthByLot[lot.id]}
                      status={lotStatusMap[lot.id]}
                      expanded={isExpanded(lot.id)}
                      onToggle={() => toggleLot(lot.id)}
                      onRename={(e) => renameLot(lot, e)}
                      onArchive={(e) => toggleArchiveLot(lot, e)}
                      onDelete={(e) => deleteLot(lot, e)}
                      onCreateDevis={() => createDevis(lot.id, null)}
                      onOpenDevis={(dv) => navigate(`/projets/${projectId}/devis/${dv.id}`)}
                      onDuplicateDevis={duplicateDevis}
                      onDeleteDevis={deleteDevis}
                      onRenameDevis={renameDevis}
                      onUpdateStatus={updateStatus}
                      devisStats={devisStats}
                      projectId={projectId}
                      isArchived
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <TemplatesTeaser compact />
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Accordéon d'un lot
// ─────────────────────────────────────────────────────────────────────────────
function LotAccordion({
  lot,
  devis,
  refDevis,
  refSynth,
  status,
  expanded,
  onToggle,
  onRename,
  onArchive,
  onDelete,
  onCreateDevis,
  onOpenDevis,
  onDuplicateDevis,
  onDeleteDevis,
  onRenameDevis,
  onUpdateStatus,
  devisStats,
  projectId,
  isArchived = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Fermeture auto du menu au click extérieur
  useEffect(() => {
    if (!menuOpen) return
    const onClick = (ev) => {
      if (menuRef.current && !menuRef.current.contains(ev.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const statusCfg = LOT_STATUS[status] || LOT_STATUS.brouillon
  const margeTone = !refSynth
    ? 'text-gray-400'
    : refSynth.pctMargeFinale > 0.2
      ? 'text-green-600'
      : refSynth.pctMargeFinale < 0
        ? 'text-red-600'
        : 'text-amber-600'

  return (
    <div className={`card overflow-hidden ${isArchived ? 'opacity-75' : ''}`}>
      {/* ── Header du lot ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
        <button
          onClick={onToggle}
          className="shrink-0 p-1 -m-1 text-gray-400 hover:text-gray-600 transition-colors"
          title={expanded ? 'Replier' : 'Déplier'}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: statusCfg.bg }}
        >
          <Package className="w-4 h-4" style={{ color: statusCfg.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900 truncate">{lot.title}</h3>
            <button
              onClick={onRename}
              title="Renommer ce lot"
              className="p-0.5 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <span
              className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
              style={{ color: statusCfg.color, background: statusCfg.bg }}
            >
              {statusCfg.label}
            </span>
            {isArchived && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium text-gray-500 bg-gray-100">
                <Archive className="w-2.5 h-2.5" />
                Archivé
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {devis.length} version{devis.length > 1 ? 's' : ''}
            {refDevis && ` · Réf. V${refDevis.version_number}`}
          </p>
        </div>

        {/* Montants synthèse lot (masqués sous md) */}
        {refSynth && (
          <div className="hidden md:flex items-center gap-5 shrink-0">
            <div className="text-right">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">HT</p>
              <p className="text-sm font-bold text-gray-900 tabular-nums">
                {fmtEur(refSynth.totalHTFinal)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
                Marge
              </p>
              <p className={`text-sm font-bold tabular-nums ${margeTone}`}>
                {fmtPct(refSynth.pctMargeFinale)}
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {!isArchived && (
            <button
              onClick={onCreateDevis}
              title="Nouvelle version dans ce lot"
              className="btn-primary btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Version
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((p) => !p)
              }}
              title="Actions sur ce lot"
              className="btn-ghost btn-sm text-gray-400 hover:text-gray-700"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => {
                    setMenuOpen(false)
                    onRename(e)
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Renommer le lot
                </button>
                <button
                  onClick={(e) => {
                    setMenuOpen(false)
                    onArchive(e)
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                >
                  {isArchived ? (
                    <>
                      <ArchiveRestore className="w-3.5 h-3.5" />
                      Désarchiver
                    </>
                  ) : (
                    <>
                      <Archive className="w-3.5 h-3.5" />
                      Archiver
                    </>
                  )}
                </button>
                {devis.length === 0 && (
                  <>
                    <div className="border-t border-gray-100 my-1" />
                    <button
                      onClick={(e) => {
                        setMenuOpen(false)
                        onDelete(e)
                      }}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-red-50 flex items-center gap-2 text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Supprimer le lot
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Corps : liste des versions ───────────────────────────────── */}
      {expanded && (
        <div className="border-t border-gray-100">
          {devis.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <p className="text-xs text-gray-500 mb-3">Aucune version dans ce lot.</p>
              {!isArchived && (
                <button onClick={onCreateDevis} className="btn-primary btn-sm">
                  <Plus className="w-3.5 h-3.5" />
                  Créer la première version
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(() => {
                // Ordre d'affichage : plus récent en haut (desc par version_number)
                const sorted = [...devis].sort(
                  (a, b) => (b.version_number || 0) - (a.version_number || 0),
                )
                const titleCounts = sorted.reduce((acc, d) => {
                  const t = (d.title || `Devis V${d.version_number}`).trim()
                  acc[t] = (acc[t] || 0) + 1
                  return acc
                }, {})
                return sorted.map((dv, idx) => {
                  const s = devisStats[dv.id]
                  const isRef = refDevis && refDevis.id === dv.id

                  // Diff vs version précédente (idx+1 dans sorted desc = celle juste avant)
                  const prevDv = sorted[idx + 1]
                  const prevStats = prevDv ? devisStats[prevDv.id] : null
                  const diffHT = s && prevStats ? s.totalHTFinal - prevStats.totalHTFinal : null
                  const diffMargePts =
                    s && prevStats
                      ? (s.pctMargeFinale - prevStats.pctMargeFinale) * 100
                      : null

                  const titleKey = (dv.title || `Devis V${dv.version_number}`).trim()
                  const isDuplicate = titleCounts[titleKey] > 1

                  const rowMargeTone = !s
                    ? 'text-gray-400'
                    : s.pctMargeFinale > 0.2
                      ? 'text-green-600'
                      : s.pctMargeFinale < 0
                        ? 'text-red-600'
                        : 'text-amber-600'

                  return (
                    <Link
                      key={dv.id}
                      to={`/projets/${projectId}/devis/${dv.id}`}
                      className="flex items-center gap-4 px-4 sm:px-5 py-3 hover:bg-blue-50/30 group transition-colors relative"
                      onClick={(e) => {
                        // Empêche la navigation si on a cliqué sur un bouton d'action
                        if (e.target.closest('button, select')) e.preventDefault()
                      }}
                    >
                      {isRef && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-green-500" />
                      )}

                      <div
                        className={`
                          w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs
                          ring-1 ring-inset
                          ${
                            isRef
                              ? 'bg-green-50 text-green-700 ring-green-200'
                              : 'bg-blue-50 text-blue-600 ring-blue-100'
                          }
                        `}
                      >
                        V{dv.version_number}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 truncate">
                            {dv.title || `Devis V${dv.version_number}`}
                          </span>
                          <button
                            onClick={(e) => onRenameDevis(dv, e)}
                            title={
                              isDuplicate
                                ? 'Plusieurs versions portent ce nom — renomme pour les distinguer'
                                : 'Renommer cette version'
                            }
                            className={`p-1 rounded transition-colors ${
                              isDuplicate
                                ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'
                                : 'text-gray-300 hover:text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {isRef && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-bold uppercase tracking-wider">
                              <Star className="w-2.5 h-2.5 fill-current" />
                              Référence
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          Créé le {new Date(dv.created_at).toLocaleDateString('fr-FR')}
                          {dv.updated_at &&
                            dv.updated_at !== dv.created_at &&
                            ` · Modifié ${new Date(dv.updated_at).toLocaleDateString('fr-FR')}`}
                        </p>
                      </div>

                      {s && (
                        <div className="hidden md:flex items-center gap-6 lg:gap-8">
                          <div className="text-right">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
                              HT
                            </p>
                            <p className="text-sm font-bold text-gray-900 tabular-nums">
                              {fmtEur(s.totalHTFinal)}
                            </p>
                            {diffHT !== null && (
                              <p
                                className={`text-[10px] tabular-nums mt-0.5 font-medium ${
                                  Math.abs(diffHT) < 0.01
                                    ? 'text-gray-300'
                                    : diffHT > 0
                                      ? 'text-green-500'
                                      : 'text-red-500'
                                }`}
                                title={`Écart vs V${prevDv.version_number}`}
                              >
                                {Math.abs(diffHT) < 0.01
                                  ? '='
                                  : `${diffHT > 0 ? '+' : ''}${fmtEur(diffHT)}`}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
                              Marge
                            </p>
                            <p className={`text-sm font-bold tabular-nums ${rowMargeTone}`}>
                              {fmtPct(s.pctMargeFinale)}
                            </p>
                            {diffMargePts !== null && (
                              <p
                                className={`text-[10px] tabular-nums mt-0.5 font-medium ${
                                  Math.abs(diffMargePts) < 0.05
                                    ? 'text-gray-300'
                                    : diffMargePts > 0
                                      ? 'text-green-500'
                                      : 'text-red-500'
                                }`}
                                title={`Écart vs V${prevDv.version_number}`}
                              >
                                {Math.abs(diffMargePts) < 0.05
                                  ? '='
                                  : `${diffMargePts > 0 ? '+' : ''}${diffMargePts.toFixed(1)} pts`}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      <div
                        className="flex items-center gap-2 shrink-0"
                        onClick={(e) => e.preventDefault()}
                      >
                        <select
                          value={dv.status}
                          onChange={(e) => onUpdateStatus(dv.id, e.target.value, e)}
                          className={`
                            text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 cursor-pointer
                            focus:outline-none focus:border-blue-400 font-semibold
                            ${STATUS_MAP[dv.status]?.cls || ''}
                          `}
                        >
                          {Object.entries(STATUS_MAP).map(([val, { label }]) => (
                            <option key={val} value={val}>
                              {label}
                            </option>
                          ))}
                        </select>

                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={(e) => onDuplicateDevis(dv, e)}
                            title="Dupliquer cette version dans ce lot"
                            className="btn-ghost btn-sm text-gray-400 hover:text-blue-600"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => onDeleteDevis(dv.id, e)}
                            title="Supprimer ce devis"
                            className="btn-ghost btn-sm text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </Link>
                  )
                })
              })()}
            </div>
          )}
        </div>
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

function TemplatesTeaser({ compact = false }) {
  return (
    <div className={`card overflow-hidden border-dashed ${compact ? '' : 'mt-1'}`}>
      <div className={`flex items-center gap-3 ${compact ? 'p-3.5' : 'p-4 sm:p-5'}`}>
        <div
          className={`shrink-0 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm ${compact ? 'w-9 h-9' : 'w-11 h-11'}`}
        >
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
            Gagnez du temps en pré-remplissant vos devis depuis vos modèles favoris (Captation Live,
            Pub, Corporate…).
          </p>
        </div>
      </div>
    </div>
  )
}

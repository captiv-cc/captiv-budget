/**
 * Budget Réel v2
 * ─ Chaque ligne du devis = une ligne de suivi (pas de re-saisie)
 * ─ Prestataire = membre de l'Équipe (projet_membres.devis_line_id)
 * ─ Coût prévu  = budget_convenu Équipe (tarif négocié) si défini,
 *                 sinon calcLine(devis_line).coutCharge
 * ─ Coût réel   = saisie inline → budget_reel entry (upsert)
 * ─ ADDITIFS par bloc pour dépenses hors-devis
 * ─ TVA 0 / 5,5 / 10 / 20 %, Validé, Payé par ligne
 * ─ Totaux par bloc + KPIs globaux
 */
import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  calcLine, fmtEur, REGIMES_SALARIES, CATS_HUMAINS,
} from '../../lib/cotisations'
import { getBlocInfo } from '../../lib/blocs'
import TvaPicker from '../../components/TvaPicker'
import { Plus, Check, X, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { TAUX_INTERM, isIntermittentLike, refCout, memberName } from '../../features/budget-reel/utils'
import {
  BlocTotal, StatusToggle, Checkbox, Th, InlineInput, InlineNumberInput, RegimeBadge,
} from '../../features/budget-reel/components/atoms'
import FournisseurSelect from '../../features/budget-reel/components/FournisseurSelect'
import KpiBar from '../../features/budget-reel/components/KpiBar'
import FiltersBar from '../../features/budget-reel/components/FiltersBar'
import BlocFooter from '../../features/budget-reel/components/BlocFooter'
import LineRow from '../../features/budget-reel/components/LineRow'
import AdditifRow from '../../features/budget-reel/components/AdditifRow'
import RecapPaiements from '../../features/budget-reel/components/RecapPaiements'

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function BudgetReelTab() {
  const { project, devisList } = useOutletContext()
  const projectId = project?.id
  const refDevis  = devisList?.find(d => d.status === 'accepte') || devisList?.[devisList.length - 1]

  const [cats,          setCats]          = useState([])
  const [lines,         setLines]         = useState([])
  const [membres,       setMembres]       = useState([])
  const [reel,          setReel]          = useState([])
  const [fournisseurs,  setFournisseurs]  = useState([])
  const [loading,       setLoading]       = useState(true)
  const [blocTermine,   setBlocTermine]   = useState({})
  // Blocs repliés (header + footer visibles, lignes masquées) — persisté par projet
  const collapseStorageKey = `budgetReel.collapsedBlocs.${projectId || 'noproj'}`
  const [blocCollapsed, setBlocCollapsed] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(collapseStorageKey) : null
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })
  useEffect(() => {
    try { window.localStorage.setItem(collapseStorageKey, JSON.stringify(blocCollapsed)) } catch {}
  }, [blocCollapsed, collapseStorageKey])
  const toggleBlocCollapsed = (catId) => setBlocCollapsed(p => ({ ...p, [catId]: !p[catId] }))
  // Filtres rapides : chacun actif/inactif indépendamment (combinables en AND)
  const [filters, setFilters] = useState({
    estimees:   false,   // lignes non saisies (état #3)
    nonPayees:  false,   // lignes saisies non payées
    ecart:      false,   // lignes avec |écart| > 10% du prévu
    additifs:   false,   // uniquement les additifs hors-devis
  })
  const toggleFilter = (k) => setFilters(f => ({ ...f, [k]: !f[k] }))
  const clearFilters = () => setFilters({ estimees: false, nonPayees: false, ecart: false, additifs: false })
  const anyFilter = filters.estimees || filters.nonPayees || filters.ecart || filters.additifs

  useEffect(() => { if (projectId && refDevis?.id) load() }, [projectId, refDevis?.id])

  async function load() {
    setLoading(true)
    const [cR, lR, mR, rR, fR] = await Promise.all([
      supabase.from('devis_categories').select('*').eq('devis_id', refDevis.id).order('sort_order'),
      supabase.from('devis_lines').select('*').eq('devis_id', refDevis.id).order('sort_order'),
      supabase.from('projet_membres')
        .select('*, contact:contacts(nom, prenom, default_tva)')
        .eq('project_id', projectId),
      supabase.from('budget_reel').select('*').eq('project_id', projectId),
      supabase.from('fournisseurs').select('*').order('nom'),
    ])
    setCats(cR.data || [])
    setLines(lR.data || [])
    setMembres(mR.data || [])
    setReel(rR.data || [])
    setFournisseurs(fR.data || [])
    setLoading(false)
  }

  // ─── Maps dérivées ─────────────────────────────────────────────────────────

  const reelByLine = Object.fromEntries(
    reel.filter(r => r.devis_line_id && !r.is_additif).map(r => [r.devis_line_id, r])
  )
  const membreByLine = Object.fromEntries(
    membres.filter(m => m.devis_line_id).map(m => [m.devis_line_id, m])
  )

  function additifsForCat(catId) {
    const cat = cats.find(c => c.id === catId)
    return reel.filter(r => r.is_additif && r.bloc_name === cat?.name)
  }

  function linesForCat(catId) {
    return lines.filter(l => l.category_id === catId)
  }

  // ─── Filtres ───────────────────────────────────────────────────────────────
  // Retourne true si la ligne passe tous les filtres actifs (AND)
  function lineMatchesFilters(line) {
    if (!anyFilter) return true
    const e  = reelByLine[line.id]
    const cp = refCout(line, membreByLine[line.id])
    const isEstimee = !e || e.montant_ht == null

    // "Mes additifs" exclut toutes les lignes du devis
    if (filters.additifs) return false

    if (filters.estimees && !isEstimee) return false
    if (filters.nonPayees && (isEstimee || e?.paye)) return false
    if (filters.ecart) {
      if (isEstimee || cp <= 0) return false
      const ratio = Math.abs(e.montant_ht - cp) / cp
      if (ratio <= 0.1) return false
    }
    return true
  }
  // Les additifs ne gardent leur place que si le filtre "Mes additifs" est actif
  // ou si aucun filtre ligne-spécifique n'est actif
  function additifMatchesFilters(a) {
    if (!anyFilter) return true
    if (filters.additifs) {
      // Dans ce mode on ne garde que les additifs, et on peut encore filtrer par paiement
      if (filters.nonPayees && a.paye) return false
      return true
    }
    // Un autre filtre ligne est actif → les additifs sont masqués
    return false
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  // Détermine le taux de TVA par défaut pour une ligne devis :
  //   1. Si un membre est rattaché à la ligne → contacts.default_tva
  //   2. Sinon si un fournisseur est assigné  → fournisseurs.default_tva
  //   3. Sinon                                → 0  (sécurité comptable)
  function defaultTvaForLine(line) {
    if (!line) return 0
    const m = membreByLine[line.id]
    if (m && m.contact && Number.isFinite(Number(m.contact?.default_tva))) {
      return Number(m.contact.default_tva)
    }
    // Le contact peut être chargé sans default_tva (champ non sélectionné) → fallback
    if (line.fournisseur_id) {
      const f = fournisseurs.find(x => x.id === line.fournisseur_id)
      if (f && Number.isFinite(Number(f?.default_tva))) return Number(f.default_tva)
    }
    return 0
  }

  // Idem pour un additif (pas de devis_line) : seul le fournisseur compte
  function defaultTvaForAdditif(fournisseurId) {
    if (!fournisseurId) return 0
    const f = fournisseurs.find(x => x.id === fournisseurId)
    return Number.isFinite(Number(f?.default_tva)) ? Number(f.default_tva) : 0
  }

  // Règle d'auto-progression : saisir un coût réel ou marquer payé valide la ligne
  function withAutoValide(fields, existing) {
    const next = { ...fields }
    const alreadyValide = existing?.valide === true
    const setsAmount    = Object.prototype.hasOwnProperty.call(fields, 'montant_ht')
    const setsPaye      = fields.paye === true
    if (!alreadyValide && next.valide !== false && (setsAmount || setsPaye)) {
      next.valide = true
    }
    return next
  }

  async function saveLineReel(lineId, fieldsRaw) {
    const existing = reelByLine[lineId]
    const fields = withAutoValide(fieldsRaw, existing)
    if (existing && !String(existing.id).startsWith('__tmp_')) {
      // ── UPDATE ─────────────────────────────────────────────────────────────
      const upd = { ...existing, ...fields }
      setReel(p => p.map(r => r.id === existing.id ? upd : r))
      const { error } = await supabase.from('budget_reel').update(fields).eq('id', existing.id)
      if (error) {
        console.error('[BudgetRéel] update:', error.message)
        setReel(p => p.map(r => r.id === existing.id ? existing : r))
      }
    } else {
      // ── INSERT (avec fallback UPDATE si la ligne existe déjà en DB) ────────
      const line = lines.find(l => l.id === lineId)
      const cat  = cats.find(c => c.id === line?.category_id)
      const payload = {
        project_id: projectId, devis_line_id: lineId,
        bloc_name: cat?.name ?? '', montant_ht: 0,
        tva_rate: defaultTvaForLine(line),
        valide: false, paye: false, is_additif: false,
        description: line?.produit || '',   // ⚠ NOT NULL en DB
        ...fields,
      }
      const tempId = `__tmp_${lineId}`
      setReel(p => [...p.filter(r => r.id !== tempId), { ...payload, id: tempId }])

      const { data, error } = await supabase
        .from('budget_reel').insert(payload).select().single()

      if (!error && data) {
        setReel(p => p.map(r => r.id === tempId ? data : r))
        return
      }

      // INSERT a échoué (contrainte unique ou colonne manquante) → chercher la ligne existante
      console.warn('[BudgetRéel] insert failed, trying fallback:', error?.message)
      const { data: found } = await supabase
        .from('budget_reel')
        .select('*')
        .eq('project_id', projectId)
        .eq('devis_line_id', lineId)
        .eq('is_additif', false)
        .maybeSingle()

      if (found) {
        // Ligne déjà en DB (état désynchronisé) → mettre à jour
        const upd = { ...found, ...fields }
        setReel(p => p.map(r => r.id === tempId ? upd : r))
        await supabase.from('budget_reel').update(fields).eq('id', found.id)
        setReel(p => p.map(r => r.id === tempId ? { ...upd, id: found.id } : r))
      } else {
        console.error('[BudgetRéel] échec définitif:', error?.message)
        setReel(p => p.filter(r => r.id !== tempId))
      }
    }
  }

  // Supprime l'entrée budget_reel d'une ligne devis → retour à l'état "pas saisi"
  async function clearLineReel(lineId) {
    const existing = reelByLine[lineId]
    if (!existing) return
    // Optimistic remove
    setReel(p => p.filter(r => r.id !== existing.id))
    if (String(existing.id).startsWith('__tmp_')) return
    const { error } = await supabase.from('budget_reel').delete().eq('id', existing.id)
    if (error) {
      console.error('[BudgetRéel] clear:', error.message)
      setReel(p => [...p, existing])
    }
  }

  // Confirme une ligne "estimé" (état #3) → crée une entrée budget_reel au coût prévu (état #2)
  async function confirmLineAtPrevu(lineId) {
    const line = lines.find(l => l.id === lineId)
    if (!line) return
    const cp = refCout(line, membreByLine[lineId])
    await saveLineReel(lineId, { montant_ht: cp })
  }

  // Confirme toutes les lignes "estimé" d'un bloc en une fois
  async function confirmBlocAtPrevu(catId) {
    const targets = lines
      .filter(l => l.category_id === catId)
      .filter(l => {
        const e = reelByLine[l.id]
        return !e || e.montant_ht == null
      })
    for (const l of targets) {
      const cp = refCout(l, membreByLine[l.id])
      await saveLineReel(l.id, { montant_ht: cp })
    }
  }

  async function addAdditif(catId) {
    const cat = cats.find(c => c.id === catId)
    const { data } = await supabase.from('budget_reel').insert({
      project_id: projectId, bloc_name: cat?.name || '',
      montant_ht: 0, tva_rate: 0, valide: false, paye: false,
      qonto_ok: false, is_additif: true, description: '', fournisseur: '',
    }).select().single()
    if (data) setReel(p => [...p, data])
  }

  async function updateAdditif(id, fieldsRaw) {
    const existing = reel.find(r => r.id === id)
    const fields = withAutoValide(fieldsRaw, existing)
    setReel(p => p.map(r => r.id === id ? { ...r, ...fields } : r))
    await supabase.from('budget_reel').update(fields).eq('id', id)
  }

  async function deleteAdditif(id) {
    if (!confirm('Supprimer cet additif ?')) return
    await supabase.from('budget_reel').delete().eq('id', id)
    setReel(p => p.filter(r => r.id !== id))
  }

  // Distribue un total global proportionnellement sur plusieurs lignes devis
  async function saveGroupTotal(lineIds, coutPrevus, totalReel) {
    const totalPrevu = coutPrevus.reduce((s, c) => s + c, 0)
    for (let i = 0; i < lineIds.length; i++) {
      const prop   = totalPrevu > 0 ? coutPrevus[i] / totalPrevu : 1 / lineIds.length
      const amount = Math.round(totalReel * prop * 100) / 100
      await saveLineReel(lineIds[i], { montant_ht: amount })
    }
  }

  // Marque toutes les lignes d'un groupe personne comme payées/non-payées
  async function saveGroupPaid(lineIds, paid) {
    for (const id of lineIds) {
      const e = reelByLine[id]
      if (e) {
        await saveLineReel(id, { paye: paid })
      } else if (paid) {
        const line = lines.find(l => l.id === id)
        const m    = membreByLine[id]
        const cp   = line ? refCout(line, m) : 0
        await saveLineReel(id, { paye: true, montant_ht: cp })
      }
    }
  }

  // Marque toutes les entrées d'un groupe fournisseur comme payées (lignes + additifs)
  async function saveFournisseurGroupPaid(items, paid) {
    for (const item of items) {
      if (item.isAdditif) {
        await updateAdditif(item.id, { paye: paid })
      } else {
        const e = reelByLine[item.id]
        if (e) await saveLineReel(item.id, { paye: paid })
      }
    }
  }

  // Propage un taux de TVA à toutes les lignes d'un groupe personne.
  // Crée l'entrée budget_reel si elle n'existe pas encore (au coût prévu).
  async function saveGroupTva(lineIds, tva) {
    for (const id of lineIds) {
      const e = reelByLine[id]
      if (e) {
        await saveLineReel(id, { tva_rate: tva })
      } else {
        const line = lines.find(l => l.id === id)
        const m    = membreByLine[id]
        const cp   = line ? refCout(line, m) : 0
        await saveLineReel(id, { tva_rate: tva, montant_ht: cp })
      }
    }
  }

  // Idem pour un groupe fournisseur (mix lignes devis + additifs)
  async function saveFournisseurGroupTva(items, tva) {
    for (const item of items) {
      if (item.isAdditif) {
        await updateAdditif(item.id, { tva_rate: tva })
      } else {
        const e = reelByLine[item.id]
        if (e) {
          await saveLineReel(item.id, { tva_rate: tva })
        } else {
          await saveLineReel(item.id, { tva_rate: tva, montant_ht: item.coutPrevu || 0 })
        }
      }
    }
  }

  // Distribue un total sur un groupe fournisseur (lignes + additifs) proportionnellement
  async function saveFournisseurGroupTotal(items, totalReel) {
    const weights = items.map(item =>
      item.isAdditif
        ? (item.entry?.montant_ht || 1)
        : (item.coutPrevu || 1)   // coutPrevu pré-calculé dans RecapPaiements
    )
    const totalW = weights.reduce((s, w) => s + w, 0)
    for (let i = 0; i < items.length; i++) {
      const prop   = totalW > 0 ? weights[i] / totalW : 1 / items.length
      const amount = Math.round(totalReel * prop * 100) / 100
      if (items[i].isAdditif) {
        await updateAdditif(items[i].id, { montant_ht: amount })
      } else {
        await saveLineReel(items[i].id, { montant_ht: amount })
      }
    }
  }

  // Applique un fournisseur (ou en crée un nouveau) à toutes les lignes vides
  // d'une catégorie + à la ligne courante
  async function applyFournisseurToBloc(currentLineId, fournisseurId, nomNouveau) {
    let fId = fournisseurId
    if (!fId && nomNouveau) {
      const { data, error } = await supabase
        .from('fournisseurs').insert({ nom: nomNouveau }).select().single()
      if (error) { console.error('[Fournisseur] create:', error); return }
      setFournisseurs(p => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom)))
      fId = data.id
    }
    const currentLine = lines.find(l => l.id === currentLineId)
    if (!currentLine) return
    // Lignes du même bloc, non humaines, sans fournisseur (ou la ligne courante)
    const targetIds = lines
      .filter(l => l.category_id === currentLine.category_id)
      .filter(l => !CATS_HUMAINS.includes(l.regime))
      .filter(l => l.id === currentLineId || !l.fournisseur_id)
      .map(l => l.id)
    setLines(p => p.map(l => targetIds.includes(l.id) ? { ...l, fournisseur_id: fId } : l))
    const { error } = await supabase
      .from('devis_lines').update({ fournisseur_id: fId }).in('id', targetIds)
    if (error) {
      console.error('[Fournisseur] bulk assign:', error)
      // rollback : recharge depuis la DB
      load()
    }
  }

  // Assigne un fournisseur (ou en crée un nouveau) à une ligne devis
  async function selectFournisseur(lineId, fournisseurId, nomNouveau) {
    let fId = fournisseurId
    if (!fId && nomNouveau) {
      // Créer un nouveau fournisseur global
      const { data, error } = await supabase
        .from('fournisseurs').insert({ nom: nomNouveau }).select().single()
      if (error) { console.error('[Fournisseur] create:', error); return }
      setFournisseurs(p => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom)))
      fId = data.id
    }
    // Optimistic update
    setLines(p => p.map(l => l.id === lineId ? { ...l, fournisseur_id: fId } : l))
    const { error } = await supabase
      .from('devis_lines').update({ fournisseur_id: fId }).eq('id', lineId)
    if (error) {
      console.error('[Fournisseur] assign:', error)
      // Rollback
      setLines(p => p.map(l => l.id === lineId ? { ...l, fournisseur_id: null } : l))
    }
  }

  // ─── KPIs globaux ──────────────────────────────────────────────────────────

  const global = (() => {
    let venteHT = 0, coutPrevu = 0
    let coutReelConfirme = 0   // uniquement saisi en DB
    let coutReelProjete  = 0   // saisi + prévu pour les non-saisis (vrai forecast)
    let nbLignes = 0, nbLignesSaisies = 0
    let resteRegler = 0
    let tvaRecuperable = 0     // TVA payée sur dépenses → récupérable

    for (const line of lines) {
      const calc = calcLine(line)
      const cp   = refCout(line, membreByLine[line.id])
      venteHT   += calc.prixVenteHT + calc.chargesFacturees
      coutPrevu += cp
      nbLignes  += 1

      const e = reelByLine[line.id]
      // null = pas de ligne en DB → projection au prévu
      // 0 ou montant > 0 = saisi explicitement
      const isSaisie = !!e && e.montant_ht != null
      if (isSaisie) {
        nbLignesSaisies += 1
        coutReelConfirme += e.montant_ht
        coutReelProjete  += e.montant_ht
        if (!e.paye && e.montant_ht > 0) resteRegler += e.montant_ht
        // TVA récupérable = HT × taux/100 (uniquement sur lignes saisies)
        tvaRecuperable += (e.montant_ht || 0) * (Number(e.tva_rate) || 0) / 100
      } else {
        // Non saisi → projection au prévu
        coutReelProjete += cp
      }
    }
    for (const a of reel.filter(r => r.is_additif)) {
      coutReelConfirme += a.montant_ht || 0
      coutReelProjete  += a.montant_ht || 0
      if (!a.paye) resteRegler += a.montant_ht || 0
      tvaRecuperable += (a.montant_ht || 0) * (Number(a.tva_rate) || 0) / 100
    }

    // TVA collectée = HT vendu × taux du devis
    const tvaCollectee = venteHT * (Number(refDevis?.tva_rate) || 0) / 100
    const tvaAReverser = Math.max(0, tvaCollectee - tvaRecuperable)

    const ecartCout    = coutReelProjete - coutPrevu     // signed (+ = dépassement)
    const margePrevue  = venteHT - coutPrevu
    const margeReelle  = venteHT - coutReelProjete
    const deltaMarge   = margeReelle - margePrevue       // signed (+ = mieux)
    const avancement   = coutPrevu > 0 ? (coutReelConfirme / coutPrevu) * 100 : 0
    const resteAEngager = Math.max(0, coutPrevu - coutReelConfirme)

    return {
      venteHT, coutPrevu, coutReelConfirme, coutReelProjete,
      margePrevue, margeReelle, deltaMarge,
      ecartCout, avancement, resteAEngager, resteRegler,
      nbLignes, nbLignesSaisies,
      tvaCollectee, tvaRecuperable, tvaAReverser,
    }
  })()

  // ─── Compteurs pour les chips de filtres ──────────────────────────────────
  const filterCounts = (() => {
    let estimees = 0, nonPayees = 0, ecart = 0
    for (const line of lines) {
      const e  = reelByLine[line.id]
      const cp = refCout(line, membreByLine[line.id])
      const isEstimee = !e || e.montant_ht == null
      if (isEstimee) { estimees += 1; continue }
      if (!e.paye) nonPayees += 1
      if (cp > 0) {
        const ratio = Math.abs(e.montant_ht - cp) / cp
        if (ratio > 0.1) ecart += 1
      }
    }
    const additifs = reel.filter(r => r.is_additif).length
    return { estimees, nonPayees, ecart, additifs }
  })()

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center p-16">
      <div className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }} />
    </div>
  )

  if (!refDevis) return (
    <div className="p-12 text-center">
      <p className="text-sm" style={{ color: 'var(--txt-3)' }}>Aucun devis disponible</p>
    </div>
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* ── KPIs (barre compacte) ────────────────────────────────────────── */}
      <KpiBar global={global} refDevis={refDevis} />

      {/* ── Filtres rapides + actions blocs ──────────────────────────────── */}
      <FiltersBar
        filters={filters}
        counts={filterCounts}
        onToggle={toggleFilter}
        onClear={clearFilters}
        anyFilter={anyFilter}
        onCollapseAll={() => {
          const next = {}
          for (const c of cats) next[c.id] = true
          setBlocCollapsed(next)
        }}
        onExpandAll={() => setBlocCollapsed({})}
        anyCollapsed={Object.values(blocCollapsed).some(Boolean)}
      />

      {/* ── Blocs ────────────────────────────────────────────────────────── */}
      {cats.map(cat => {

        const allCatLines    = linesForCat(cat.id)
        const allCatAdditifs = additifsForCat(cat.id)
        if (allCatLines.length === 0 && allCatAdditifs.length === 0) return null
        // Filtrage : les totaux et l'en-tête restent calculés sur TOUTES les lignes
        // (on veut voir le budget complet), seule la liste affichée est réduite.
        const catLines    = allCatLines.filter(lineMatchesFilters)
        const catAdditifs = allCatAdditifs.filter(additifMatchesFilters)
        // Masque complètement le bloc si plus rien à afficher sous un filtre actif
        if (anyFilter && catLines.length === 0 && catAdditifs.length === 0) return null

        const blocInfo   = getBlocInfo(cat.name)
        const isTermine  = !!blocTermine[cat.id]
        const isCollapsed = !!blocCollapsed[cat.id]

        // Les totaux et le compteur d'estimées se calculent TOUJOURS sur l'ensemble du bloc,
        // indépendamment des filtres (sinon les chiffres deviennent incohérents).
        let venteBloc = 0, prevuBloc = 0, reelBloc = 0, resteBloc = 0
        for (const line of allCatLines) {
          const calc = calcLine(line)
          const cp   = refCout(line, membreByLine[line.id])
          venteBloc += calc.prixVenteHT + calc.chargesFacturees
          prevuBloc += cp
          const e = reelByLine[line.id]
          // null = pas de saisie → projette au prévu ; sinon (y compris 0) = valeur saisie
          const lineReel = e?.montant_ht != null ? e.montant_ht : cp
          reelBloc += lineReel
          if (!e?.paye && lineReel > 0) resteBloc += lineReel
        }
        for (const a of allCatAdditifs) {
          reelBloc    += a.montant_ht || 0
          if (!a.paye) resteBloc += a.montant_ht || 0
        }
        const beneficePrevis = venteBloc - prevuBloc
        const beneficeReel   = venteBloc - reelBloc
        const nbEstimes = allCatLines.filter(l => {
          const e = reelByLine[l.id]
          return !e || e.montant_ht == null
        }).length
        // Nombre de lignes masquées par les filtres
        const nbMasquees = (allCatLines.length - catLines.length) + (allCatAdditifs.length - catAdditifs.length)

        return (
          <div key={cat.id} className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}>

            {/* En-tête bloc (cliquable pour replier/déplier) */}
            <div className="flex items-center gap-3 px-4 py-2.5"
              onClick={() => toggleBlocCollapsed(cat.id)}
              style={{
                background: 'var(--bg-elev)',
                borderBottom: isCollapsed ? 'none' : '1px solid var(--brd-sub)',
                cursor: 'pointer',
                userSelect: 'none',
              }}>
              {isCollapsed
                ? <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                : <ChevronDown  className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />}
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: blocInfo.color }} />
              <span className="text-[11px] font-bold uppercase tracking-widest flex-1"
                style={{ color: blocInfo.color }}>
                {blocInfo.label}
                {isCollapsed && (
                  <span className="ml-2 normal-case tracking-normal" style={{ color: 'var(--txt-3)', fontWeight: 500, fontSize: 10 }}>
                    · {allCatLines.length + allCatAdditifs.length} ligne{allCatLines.length + allCatAdditifs.length > 1 ? 's' : ''}
                  </span>
                )}
              </span>
              {nbEstimes >= 2 && (
                <button
                  onClick={(ev) => {
                    ev.stopPropagation()
                    if (confirm(`Confirmer ${nbEstimes} ligne${nbEstimes > 1 ? 's' : ''} au coût prévu ?`))
                      confirmBlocAtPrevu(cat.id)
                  }}
                  className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
                  style={{
                    background: 'rgba(255,174,0,.12)',
                    color: 'var(--amber)',
                    border: '1px solid rgba(255,174,0,.35)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,174,0,.22)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,174,0,.12)'}
                  title="Créer une entrée budget réel au coût prévu pour les lignes non saisies">
                  <Check className="w-2.5 h-2.5" />
                  Confirmer les {nbEstimes} restantes
                </button>
              )}
              <button
                onClick={(ev) => { ev.stopPropagation(); setBlocTermine(p => ({ ...p, [cat.id]: !isTermine })) }}
                className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
                style={{
                  background: isTermine ? 'rgba(0,200,117,.15)' : 'transparent',
                  color:      isTermine ? 'var(--green)' : 'var(--txt-3)',
                  border:     `1px solid ${isTermine ? 'rgba(0,200,117,.3)' : 'var(--brd)'}`,
                }}>
                {isTermine && <Check className="w-2.5 h-2.5" />}
                TERMINÉ
              </button>
            </div>

            {/* Table (masquée si bloc replié) */}
            {!isCollapsed && (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                    <Th left style={{ minWidth: 150 }}>Produit</Th>
                    <Th left style={{ minWidth: 110 }}>Prestataire</Th>
                    <Th right style={{ minWidth: 90 }}>Vendu HT</Th>
                    <Th right style={{ minWidth: 170 }}>Coût prévu → réel</Th>
                    <Th center style={{ width: 56 }}>Statut</Th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Lignes du bloc éligibles à un fournisseur (non humaines) — sur le bloc complet
                    const blocFournLines = allCatLines.filter(l => !CATS_HUMAINS.includes(l.regime))
                    const emptyInBloc    = blocFournLines.filter(l => !l.fournisseur_id).length
                    return catLines.map((line, idx) => {
                    const calc      = calcLine(line)
                    const memb      = membreByLine[line.id]
                    const entry     = reelByLine[line.id]
                    const cp        = refCout(line, memb)
                    const hasConvenu = memb?.budget_convenu != null
                    const ecart     = entry?.montant_ht != null ? entry.montant_ht - cp : null
                    // Vendu HT réel = tarif + charges facturées au client (pass-through intermittents)
                    const venduHT   = calc.prixVenteHT + calc.chargesFacturees

                    const isHuman = CATS_HUMAINS.includes(line.regime)
                    // Nombre d'AUTRES lignes vides du bloc (hors ligne courante)
                    const otherEmptyInBloc = isHuman ? 0
                      : Math.max(0, emptyInBloc - (line.fournisseur_id ? 0 : 1))
                    return (
                      <LineRow
                        key={line.id}
                        line={line}
                        prixVenteHT={venduHT}
                        coutPrevu={cp}
                        hasConvenu={hasConvenu}
                        prestataire={memberName(memb)}
                        isIntermittent={isIntermittentLike(line.regime)}
                        isHuman={isHuman}
                        entry={entry}
                        ecart={ecart}
                        odd={idx % 2 === 1}
                        fournisseurId={line.fournisseur_id}
                        fournisseurs={fournisseurs}
                        otherEmptyInBloc={otherEmptyInBloc}
                        onSave={(fields) => saveLineReel(line.id, fields)}
                        onClear={() => clearLineReel(line.id)}
                        onConfirmAtPrevu={() => confirmLineAtPrevu(line.id)}
                        onSelectFournisseur={(fId, nom) => selectFournisseur(line.id, fId, nom)}
                        onApplyFournisseurToBloc={(fId, nom) => applyFournisseurToBloc(line.id, fId, nom)}
                      />
                    )
                  })
                  })()}

                  {/* ADDITIFS */}
                  {catAdditifs.length > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 pt-3 pb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: 'var(--txt-3)' }}>Additifs</span>
                      </td>
                    </tr>
                  )}
                  {catAdditifs.map((a, idx) => (
                    <AdditifRow
                      key={a.id}
                      entry={a}
                      odd={idx % 2 === 1}
                      onChange={(f) => updateAdditif(a.id, f)}
                      onDelete={() => deleteAdditif(a.id)}
                    />
                  ))}

                  {nbMasquees > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-1.5 text-center text-[10px] italic"
                        style={{ color: 'var(--txt-3)', background: 'rgba(0,122,255,.04)' }}>
                        {nbMasquees} ligne{nbMasquees > 1 ? 's' : ''} masquée{nbMasquees > 1 ? 's' : ''} par les filtres actifs
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={5} className="px-4 py-2">
                      <button
                        onClick={() => addAdditif(cat.id)}
                        className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg transition-all"
                        style={{ color: 'var(--txt-3)', border: '1px dashed var(--brd)' }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--blue)'; e.currentTarget.style.borderColor = 'rgba(0,122,255,.4)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--txt-3)'; e.currentTarget.style.borderColor = 'var(--brd)' }}>
                        <Plus className="w-3 h-3" /> Additif hors-devis
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            )}

            {/* Totaux bloc — mêmes 3 colonnes que la KpiBar globale */}
            <BlocFooter
              venteBloc={venteBloc}
              prevuBloc={prevuBloc}
              reelBloc={reelBloc}
              beneficePrevis={beneficePrevis}
              beneficeReel={beneficeReel}
              resteBloc={resteBloc}
            />
          </div>
        )
      })}
      {/* ── Récap Paiements ──────────────────────────────────────────────── */}
      <RecapPaiements
        lines={lines}
        membres={membres}
        reel={reel}
        reelByLine={reelByLine}
        membreByLine={membreByLine}
        fournisseurs={fournisseurs}
        onSaveGroupTotal={saveGroupTotal}
        onSaveGroupPaid={saveGroupPaid}
        onSaveGroupTva={saveGroupTva}
        onSaveFournisseurGroupTotal={saveFournisseurGroupTotal}
        onSaveFournisseurGroupPaid={saveFournisseurGroupPaid}
        onSaveFournisseurGroupTva={saveFournisseurGroupTva}
      />

    </div>
  )
}

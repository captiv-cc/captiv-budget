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

const TAUX_INTERM = 0.67

// ─── helpers ──────────────────────────────────────────────────────────────────

function isIntermittentLike(regime) {
  return REGIMES_SALARIES.includes(regime) || regime === 'Ext. Intermittent'
}

/**
 * Coût de référence d'une ligne :
 * Si le membre a un budget_convenu (tarif négocié dans Équipe) → on l'utilise
 * (× 1+taux si intermittent pour inclure les charges patronales)
 * Sinon → coutCharge du devis (calcul standard)
 */
function refCout(line, membre) {
  const bc = membre?.budget_convenu
  if (bc != null) {
    return isIntermittentLike(line.regime) ? bc * (1 + TAUX_INTERM) : bc
  }
  return calcLine(line).coutCharge
}

function memberName(m) {
  if (!m) return null
  return `${m.prenom || ''} ${m.nom || ''}`.trim() || null
}

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

// ══════════════════════════════════════════════════════════════════════════════
// LIGNE DEVIS
// ══════════════════════════════════════════════════════════════════════════════
function LineRow({ line, prixVenteHT, coutPrevu, hasConvenu, prestataire,
                   isIntermittent, isHuman, entry, ecart, odd,
                   fournisseurId, fournisseurs, otherEmptyInBloc,
                   onSave, onClear, onConfirmAtPrevu, onSelectFournisseur, onApplyFournisseurToBloc }) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const [hover, setHover]     = useState(false)
  const inputRef = useRef(null)

  const coutReel = entry?.montant_ht ?? null
  const valide   = entry?.valide     ?? false
  const paye     = entry?.paye       ?? false
  const isEstime = coutReel == null   // état #3

  const ecartColor = ecart == null ? null
    : ecart >  0.005 ? 'var(--red)'
    : ecart < -0.005 ? 'var(--green)'
    : 'var(--txt-3)'

  function startEdit() {
    setEditVal(coutReel != null ? String(coutReel) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    const trimmed = (editVal ?? '').trim()
    if (trimmed === '') {
      // Vidé → efface l'entrée et revient à "estimé" (coût prévu en italique)
      if (entry) onClear?.()
    } else {
      const val = parseFloat(trimmed)
      if (!isNaN(val)) {
        onSave({
          montant_ht: val,
          valide:   entry?.valide   ?? false,
          paye:     entry?.paye     ?? false,
          tva_rate: entry?.tva_rate ?? 20,
        })
      }
    }
    setEditing(false)
  }

  const rowBg = isEstime
    ? 'rgba(255,174,0,.04)'
    : odd ? 'var(--bg-elev)' : 'var(--bg-surf)'

  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: rowBg,
        borderBottom: '1px solid var(--brd-sub)',
        borderLeft: isEstime ? '2px solid rgba(255,174,0,.45)' : '2px solid transparent',
      }}>

      {/* Produit + tags (régime + description) sur ligne unique sous le nom */}
      <td className="px-3 py-2">
        <p className="font-medium" style={{ color: 'var(--txt)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {line.produit || '—'}
        </p>
        {(line.regime || line.description) && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {line.regime && <RegimeBadge regime={line.regime} />}
            {line.description && (
              <span style={{
                display: 'inline-block',
                fontSize: 9,
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'var(--bg-elev)',
                color: 'var(--txt-3)',
                letterSpacing: '0.03em',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={line.description}>
                {line.description}
              </span>
            )}
          </div>
        )}
      </td>

      {/* Prestataire / Fournisseur */}
      <td className="px-3 py-2">
        {isHuman && prestataire ? (
          /* Ligne humaine avec membre assigné → nom fixe */
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium" style={{ color: 'var(--txt)' }}>{prestataire}</span>
            {hasConvenu && (
              <Lock className="w-3 h-3 shrink-0" style={{ color: 'var(--purple)' }}
                title="Tarif convenu (négocié)" />
            )}
          </span>
        ) : (
          /* Ligne tech/frais ou sans membre → sélecteur fournisseur */
          <FournisseurSelect
            fournisseurId={fournisseurId}
            fournisseurs={fournisseurs || []}
            otherEmptyInBloc={otherEmptyInBloc}
            onSelect={onSelectFournisseur}
            onApplyToBloc={onApplyFournisseurToBloc}
          />
        )}
      </td>

      {/* Vendu HT */}
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="font-semibold" style={{ color: 'var(--blue)' }}>{fmtEur(prixVenteHT)}</span>
      </td>

      {/* Coût prévu → réel (colonne fusionnée, éditable au clic) */}
      <td className="px-3 py-2 text-right tabular-nums"
        onClick={!editing ? startEdit : undefined}
        style={{ cursor: editing ? 'default' : 'text' }}>
        {editing ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            <span className="font-semibold" style={{ color: 'var(--amber)' }}>{fmtEur(coutPrevu)}</span>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
            <input
              ref={inputRef}
              type="number"
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
              style={{
                width: 80, textAlign: 'right',
                background: 'var(--bg-elev)',
                border: '1px solid var(--blue)',
                borderRadius: 6,
                color: 'var(--txt)',
                padding: '2px 6px',
                fontSize: 12,
                outline: 'none',
              }}
              placeholder="0.00" step="0.01"
            />
          </span>
        ) : coutReel != null ? (
          /* États #1 et #2 — valeur saisie : prévu → réel + écart sous-ligne */
          <span>
            <span className="inline-flex items-baseline justify-end gap-1.5">
              <span className="font-semibold" style={{ color: 'var(--amber)' }}>{fmtEur(coutPrevu)}</span>
              <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
              <span className="font-semibold" style={{ color: ecartColor ?? 'var(--txt)' }}>
                {fmtEur(coutReel)}
              </span>
            </span>
            {ecart != null && Math.abs(ecart) > 0.005 ? (
              <span style={{ fontSize: 9, color: ecartColor, display: 'block' }}>
                {ecart > 0 ? '+' : ''}{fmtEur(ecart)} ({((ecart / (coutPrevu || 1)) * 100).toFixed(0)} %)
              </span>
            ) : hasConvenu && isIntermittent ? (
              <span style={{ color: 'var(--txt-3)', fontSize: 9, display: 'block' }}>brut + charges</span>
            ) : null}
          </span>
        ) : (
          /* État #3 — non saisi : prévu en italique + bouton ✓ au survol */
          <span className="inline-flex items-center justify-end gap-1.5" style={{ width: '100%' }}>
            <button
              onClick={(e) => { e.stopPropagation(); onConfirmAtPrevu?.() }}
              title="Confirmer ce montant au coût prévu"
              style={{
                opacity: hover ? 1 : 0,
                transition: 'opacity .15s, background .15s',
                width: 20, height: 20, borderRadius: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,174,0,.15)',
                border: '1px solid rgba(255,174,0,.5)',
                color: 'var(--amber)', cursor: 'pointer', flexShrink: 0,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,174,0,.3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,174,0,.15)'}>
              <Check className="w-3 h-3" />
            </button>
            <span>
              <span className="font-semibold" style={{ color: 'var(--amber)', opacity: 0.65, fontStyle: 'italic' }}>
                {fmtEur(coutPrevu)}
              </span>
              <span style={{ fontSize: 9, color: 'var(--txt-3)', opacity: 0.55, display: 'block', fontStyle: 'italic' }}>
                estimé
              </span>
            </span>
          </span>
        )}
      </td>

      {/* Statut — 3 états : estimé / validé / payé */}
      <td className="px-2 py-2 text-center">
        <StatusToggle
          isEstime={isEstime}
          valide={valide}
          paye={paye}
          onConfirmAtPrevu={onConfirmAtPrevu}
          onTogglePaye={() => onSave({
            paye: !paye,
            montant_ht: entry?.montant_ht ?? 0,
            valide:     entry?.valide     ?? false,
            tva_rate:   entry?.tva_rate   ?? 20,
          })}
        />
      </td>
    </tr>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// LIGNE ADDITIF (dépense hors-devis)
// ══════════════════════════════════════════════════════════════════════════════
function AdditifRow({ entry: a, odd, onChange, onDelete }) {
  return (
    <tr style={{
      background: odd ? 'rgba(255,174,0,.04)' : 'rgba(255,174,0,.02)',
      borderBottom: '1px solid var(--brd-sub)',
    }}>
      <td className="px-3 py-1.5">
        <InlineInput value={a.fournisseur || ''} placeholder="Fournisseur"
          onChange={v => onChange({ fournisseur: v })}
          style={{ color: 'var(--txt)', fontWeight: 500, fontSize: 12 }} />
      </td>
      <td className="px-3 py-1.5" colSpan={2}>
        <InlineInput value={a.description || ''} placeholder="Description de la dépense"
          onChange={v => onChange({ description: v })}
          style={{ color: 'var(--txt-3)', fontSize: 12 }} />
      </td>
      <td className="px-3 py-1.5 text-right">
        <span className="inline-flex items-baseline justify-end gap-1.5">
          <span style={{ color: 'var(--txt-3)', fontSize: 10, fontStyle: 'italic' }}>hors devis</span>
          <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
          <InlineNumberInput
            value={a.montant_ht || 0}
            onChange={v => onChange({ montant_ht: v })}
            style={{ color: a.montant_ht > 0 ? 'var(--red)' : 'var(--txt-3)', fontWeight: 600, fontSize: 12 }} />
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <StatusToggle
            isEstime={!a.montant_ht || a.montant_ht === 0}
            valide={!!a.valide}
            paye={!!a.paye}
            onConfirmAtPrevu={null}
            onTogglePaye={() => onChange({ paye: !a.paye })}
          />
          <button onClick={onDelete}
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
            <X className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MICRO-COMPOSANTS
// ══════════════════════════════════════════════════════════════════════════════

// ─── Barre KPI compacte ────────────────────────────────────────────────────
function KpiBar({ global: g, refDevis }) {
  const ecartColor = g.ecartCout > 0.01 ? 'var(--red)' : g.ecartCout < -0.01 ? 'var(--green)' : 'var(--txt-3)'
  const margeColor = g.margeReelle < 0 ? 'var(--red)'
                    : g.deltaMarge < -0.01 ? 'var(--amber)'
                    : 'var(--green)'
  const margePct   = g.venteHT ? (g.margeReelle / g.venteHT) * 100 : 0
  const ecartPct   = g.coutPrevu ? (g.ecartCout / g.coutPrevu) * 100 : 0

  const Block = ({ label, children, flex = 1 }) => (
    <div style={{ flex, minWidth: 0, padding: '0 14px' }}>
      <p className="text-[9px] font-semibold uppercase tracking-widest mb-0.5"
        style={{ color: 'var(--txt-3)' }}>{label}</p>
      {children}
    </div>
  )
  const Sep = () => <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--brd)' }} />

  return (
    <div className="rounded-xl"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>

      {/* Ligne principale : Vente · Coût · Marge */}
      <div className="flex items-stretch py-3">
        <Block label="Vente HT">
          <p className="font-bold tabular-nums text-lg" style={{ color: 'var(--blue)' }}>{fmtEur(g.venteHT)}</p>
          <p className="text-[9px]" style={{ color: 'var(--txt-3)' }}>
            Devis V{refDevis.version_number}{refDevis.status === 'accepte' ? ' · accepté' : ''}
          </p>
        </Block>

        <Sep />

        <Block label="Coût  prévu → réel" flex={1.4}>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold tabular-nums text-sm" style={{ color: 'var(--amber)' }}>{fmtEur(g.coutPrevu)}</span>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
            <span className="font-bold tabular-nums text-lg" style={{ color: g.ecartCout > 0.01 ? 'var(--red)' : 'var(--green)' }}>{fmtEur(g.coutReelProjete)}</span>
          </div>
          <p className="text-[9px]" style={{ color: ecartColor }}>
            {g.ecartCout > 0 ? '+' : ''}{fmtEur(g.ecartCout)} ({g.ecartCout > 0 ? '+' : ''}{ecartPct.toFixed(1)} %) {g.ecartCout > 0.01 ? '· dépassement' : g.ecartCout < -0.01 ? '· économie' : '· =prévu'}
          </p>
        </Block>

        <Sep />

        <Block label="Marge  prévue → réelle" flex={1.4}>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold tabular-nums text-sm" style={{ color: 'var(--purple)' }}>{fmtEur(g.margePrevue)}</span>
            <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>→</span>
            <span className="font-bold tabular-nums text-lg" style={{ color: margeColor }}>{fmtEur(g.margeReelle)}</span>
          </div>
          <p className="text-[9px]" style={{ color: margeColor }}>
            {margePct.toFixed(1)} % du CA · {g.deltaMarge > 0 ? '+' : ''}{fmtEur(g.deltaMarge)} vs prévu
          </p>
        </Block>
      </div>

      {/* Ligne secondaire : avancement · cashflow */}
      <div className="flex items-center px-4 py-1.5 gap-4 text-[10px]"
        style={{ borderTop: '1px solid var(--brd)', color: 'var(--txt-3)' }}>
        <div className="flex items-center gap-2 flex-1">
          <span className="uppercase tracking-wide font-semibold" style={{ color: 'var(--txt-3)', fontSize: 9 }}>
            Budget engagé
          </span>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-elev)', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, g.avancement)}%`, height: '100%',
              background: g.avancement > 100.5 ? 'var(--red)'
                : g.avancement >= 99 ? 'var(--green)'
                : g.avancement >= 50 ? 'var(--blue)'
                : 'var(--amber)',
            }} />
          </div>
          <span className="tabular-nums" style={{
            color: g.avancement > 100.5 ? 'var(--red)' : 'var(--txt)',
            fontWeight: 600,
          }}>{g.avancement.toFixed(0)} %</span>
          <span style={{ opacity: 0.7 }}>· {g.nbLignesSaisies}/{g.nbLignes} lignes confirmées</span>
        </div>
        <span>·</span>
        <span>
          Reste à engager <span className="tabular-nums font-semibold" style={{
            color: g.ecartCout > 0.01 ? 'var(--red)'
              : g.resteAEngager > 0 ? 'var(--amber)'
              : 'var(--green)',
          }}>{fmtEur(g.resteAEngager)}</span>
        </span>
        <span>·</span>
        <span>
          Reste à régler <span className="tabular-nums font-semibold" style={{ color: g.resteRegler > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmtEur(g.resteRegler)}</span>
        </span>
      </div>

      {/* Ligne TVA — collectée · récupérable · à reverser */}
      <div className="flex items-center px-4 py-1.5 gap-4 text-[10px]"
        style={{ borderTop: '1px solid var(--brd)', color: 'var(--txt-3)' }}>
        <span className="uppercase tracking-wide font-semibold" style={{ color: 'var(--txt-3)', fontSize: 9 }}>
          TVA
        </span>
        <span>
          Collectée <span className="tabular-nums font-semibold" style={{ color: 'var(--blue)' }}>{fmtEur(g.tvaCollectee)}</span>
        </span>
        <span>·</span>
        <span>
          Récupérable <span className="tabular-nums font-semibold" style={{ color: 'var(--green)' }}>{fmtEur(g.tvaRecuperable)}</span>
        </span>
        <span>·</span>
        <span className="ml-auto">
          À reverser <span className="tabular-nums font-bold" style={{
            color: g.tvaAReverser > 0 ? 'var(--amber)' : 'var(--txt-3)',
            fontSize: 11,
          }}>{fmtEur(g.tvaAReverser)}</span>
        </span>
      </div>
    </div>
  )
}

// ─── Barre de filtres (chips) ──────────────────────────────────────────────
function FiltersBar({ filters, counts, onToggle, onClear, anyFilter, onCollapseAll, onExpandAll, anyCollapsed }) {
  const allChips = [
    { key: 'estimees',  label: 'Non saisies',  count: counts.estimees,  color: 'var(--amber)' },
    { key: 'nonPayees', label: 'Non payées',   count: counts.nonPayees, color: 'var(--blue)'  },
    { key: 'ecart',     label: 'Écart > 10 %', count: counts.ecart,     color: 'var(--red)'   },
    { key: 'additifs',  label: 'Additifs',     count: counts.additifs,  color: 'var(--red)'   },
  ]
  // On masque les chips à 0 (sauf si déjà actifs, pour pouvoir les désactiver)
  const chips = allChips.filter(c => (c.count || 0) > 0 || filters[c.key])
  const hasFilterArea = chips.length > 0 || anyFilter

  return (
    <div className="flex items-center gap-2 flex-wrap px-1">
      {hasFilterArea && (
        <span className="text-[9px] uppercase tracking-widest font-semibold"
          style={{ color: 'var(--txt-3)' }}>Filtres</span>
      )}

      {chips.map(c => {
        const active = filters[c.key]
        return (
          <button
            key={c.key}
            onClick={() => onToggle(c.key)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all"
            style={{
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              background: active ? c.color : 'var(--bg-surf)',
              color: active ? 'white' : 'var(--txt)',
              border: `1px solid ${active ? c.color : 'var(--brd)'}`,
            }}
          >
            <span>{c.label}</span>
            <span className="tabular-nums rounded-full px-1.5"
              style={{
                fontSize: 9,
                background: active ? 'rgba(255,255,255,.25)' : 'var(--bg-elev)',
                color: active ? 'white' : 'var(--txt-3)',
                minWidth: 16,
                textAlign: 'center',
              }}>
              {c.count || 0}
            </span>
          </button>
        )
      })}

      {anyFilter && (
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all"
          style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'transparent',
            color: 'var(--txt-3)',
            border: '1px dashed var(--brd)',
          }}
        >
          <X className="w-2.5 h-2.5" />
          Tout effacer
        </button>
      )}

      {/* Actions blocs (à droite) */}
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onCollapseAll}
          title="Replier tous les blocs"
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all"
          style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'var(--bg-surf)',
            color: 'var(--txt-3)',
            border: '1px solid var(--brd)',
            cursor: 'pointer',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--txt)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
          <ChevronRight className="w-2.5 h-2.5" />
          Tout replier
        </button>
        {anyCollapsed && (
          <button
            onClick={onExpandAll}
            title="Déplier tous les blocs"
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-all"
            style={{
              fontSize: 10,
              fontWeight: 600,
              background: 'var(--bg-surf)',
              color: 'var(--txt-3)',
              border: '1px solid var(--brd)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--txt)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
            <ChevronDown className="w-2.5 h-2.5" />
            Tout déplier
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Footer KPI compact d'un bloc (mirror de KpiBar globale) ───────────────
function BlocFooter({ venteBloc, prevuBloc, reelBloc, beneficePrevis, beneficeReel, resteBloc }) {
  const ecartCout  = reelBloc - prevuBloc                                  // signed
  const ecartPct   = prevuBloc > 0 ? (ecartCout / prevuBloc) * 100 : 0
  const margePct   = venteBloc > 0 ? (beneficeReel / venteBloc) * 100 : 0
  const deltaMarge = beneficeReel - beneficePrevis

  const coutColor = ecartCout > 0.01 ? 'var(--red)'
                  : ecartCout < -0.01 ? 'var(--green)'
                  : 'var(--txt)'
  const margeColor = beneficeReel < 0 ? 'var(--red)'
                   : deltaMarge < -0.01 ? 'var(--amber)'
                   : 'var(--green)'
  const ecartLabelColor = ecartCout > 0.01 ? 'var(--red)'
                        : ecartCout < -0.01 ? 'var(--green)'
                        : 'var(--txt-3)'

  const Lbl = ({ children }) => (
    <span className="uppercase tracking-widest font-semibold"
      style={{ color: 'var(--txt-3)', fontSize: 9 }}>{children}</span>
  )
  const Sep = () => <span style={{ color: 'var(--brd)', fontSize: 11 }}>·</span>

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 flex-wrap"
      style={{ borderTop: '1px solid var(--brd-sub)', background: 'var(--bg-elev)', fontSize: 11 }}>

      {/* Vente */}
      <span className="flex items-baseline gap-1.5">
        <Lbl>Vente</Lbl>
        <span className="font-bold tabular-nums" style={{ color: 'var(--blue)', fontSize: 12 }}>
          {fmtEur(venteBloc)}
        </span>
      </span>

      <Sep />

      {/* Coût prévu → réel + écart inline */}
      <span className="flex items-baseline gap-1.5">
        <Lbl>Coût</Lbl>
        <span className="tabular-nums" style={{ color: 'var(--amber)' }}>{fmtEur(prevuBloc)}</span>
        <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>→</span>
        <span className="font-bold tabular-nums" style={{ color: coutColor, fontSize: 12 }}>
          {fmtEur(reelBloc)}
        </span>
        {Math.abs(ecartCout) >= 0.01 && (
          <span className="tabular-nums" style={{ color: ecartLabelColor, fontSize: 10 }}>
            ({ecartCout > 0 ? '+' : ''}{ecartPct.toFixed(0)} %)
          </span>
        )}
      </span>

      <Sep />

      {/* Marge prévue → réelle + % CA */}
      <span className="flex items-baseline gap-1.5">
        <Lbl>Marge</Lbl>
        <span className="tabular-nums" style={{ color: 'var(--purple)' }}>{fmtEur(beneficePrevis)}</span>
        <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>→</span>
        <span className="font-bold tabular-nums" style={{ color: margeColor, fontSize: 12 }}>
          {fmtEur(beneficeReel)}
        </span>
        {venteBloc > 0 && (
          <span className="tabular-nums" style={{ color: margeColor, fontSize: 10 }}>
            ({margePct.toFixed(0)} %)
          </span>
        )}
      </span>

      {/* Pastille statut paiement à droite */}
      {resteBloc > 0 && (
        <span className="ml-auto px-2 py-0.5 rounded-md font-semibold whitespace-nowrap"
          style={{ background: 'rgba(255,59,48,.1)', color: 'var(--red)', fontSize: 10 }}>
          Reste {fmtEur(resteBloc)}
        </span>
      )}
      {resteBloc === 0 && reelBloc > 0 && (
        <span className="ml-auto px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 whitespace-nowrap"
          style={{ background: 'rgba(0,200,117,.1)', color: 'var(--green)', fontSize: 10 }}>
          <Check className="w-2.5 h-2.5" /> Tout réglé
        </span>
      )}
    </div>
  )
}

function BlocTotal({ label, value, color = 'default' }) {
  const C = { blue: 'var(--blue)', amber: 'var(--amber)', green: 'var(--green)', red: 'var(--red)', default: 'var(--txt)' }
  return (
    <span>
      <span style={{ color: 'var(--txt-3)' }}>{label} </span>
      <span className="font-bold tabular-nums" style={{ color: C[color] || C.default }}>{value}</span>
    </span>
  )
}

// ─── StatusToggle — 3 états : estimé / validé / payé ───────────────────────
// Estimé  → cercle vide ambre (clic = confirmer au prévu, déclenche valide auto)
// Validé  → cercle plein bleu  (clic = marquer payé)
// Payé    → cercle plein vert  (clic = annuler payé → retour à validé)
function StatusToggle({ isEstime, valide, paye, onConfirmAtPrevu, onTogglePaye }) {
  let state, color, title, fill, Icon, onClick
  if (paye) {
    state = 'paye'; color = 'var(--green)'; fill = true; Icon = Check
    title = 'Payé · clic pour annuler le paiement'
    onClick = onTogglePaye
  } else if (isEstime) {
    state = 'estime'; color = 'var(--amber)'; fill = false; Icon = null
    title = 'Estimé · clic pour confirmer le coût au prévu'
    onClick = onConfirmAtPrevu
  } else {
    // saisi (auto-validé) mais non payé
    state = 'valide'; color = 'var(--blue)'; fill = true; Icon = Check
    title = 'Validé · clic pour marquer payé'
    onClick = onTogglePaye
  }

  return (
    <button
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      title={title}
      disabled={!onClick}
      className="w-4 h-4 rounded-full flex items-center justify-center transition-all mx-auto"
      style={{
        background: fill ? color : 'transparent',
        border: `1.5px solid ${color}`,
        cursor: onClick ? 'pointer' : 'default',
      }}>
      {Icon && <Icon className="w-2.5 h-2.5" style={{ color: 'white' }} />}
    </button>
  )
}

function Checkbox({ checked, onChange, color = 'blue' }) {
  const C = { blue: 'var(--blue)', green: 'var(--green)' }
  const c = C[color] || C.blue
  return (
    <button onClick={() => onChange(!checked)}
      className="w-4 h-4 rounded flex items-center justify-center transition-all mx-auto"
      style={{ background: checked ? c : 'transparent', border: `1.5px solid ${checked ? c : 'var(--brd)'}` }}>
      {checked && <Check className="w-2.5 h-2.5" style={{ color: 'white' }} />}
    </button>
  )
}

function Th({ children, left, right, center, style }) {
  return (
    <th className="px-3 py-2 font-semibold uppercase tracking-wide whitespace-nowrap"
      style={{ color: 'var(--txt-3)', fontSize: 10, textAlign: left ? 'left' : right ? 'right' : 'center', ...style }}>
      {children}
    </th>
  )
}

function InlineInput({ value, placeholder, onChange, style }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input value={v} placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== value) onChange(v) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      style={{ background: 'transparent', border: 'none', outline: 'none', width: '100%', ...style }} />
  )
}

/**
 * Sélecteur fournisseur avec autocomplétion et création rapide.
 * Sauvegarde via devis_lines.fournisseur_id (fiable, indépendant de budget_reel).
 */
function FournisseurSelect({ fournisseurId, fournisseurs, otherEmptyInBloc = 0, onSelect, onApplyToBloc }) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const [bulk,  setBulk]  = useState(false)
  const inputRef    = useRef(null)
  const containerRef = useRef(null)

  const current  = fournisseurs.find(f => f.id === fournisseurId)
  const filtered = fournisseurs.filter(f =>
    f.nom.toLowerCase().includes(query.toLowerCase())
  )
  const hasExact = fournisseurs.some(f =>
    f.nom.toLowerCase() === query.trim().toLowerCase()
  )

  useEffect(() => {
    if (open) {
      setQuery('')
      setBulk(false)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(f) {
    setOpen(false)
    if (bulk && otherEmptyInBloc > 0) onApplyToBloc?.(f.id, null)
    else onSelect(f.id, null)
  }

  function createAndPick() {
    const nom = query.trim()
    if (!nom) return
    setOpen(false)
    if (bulk && otherEmptyInBloc > 0) onApplyToBloc?.(null, nom)
    else onSelect(null, nom)
  }

  function clear(e) {
    e.stopPropagation()
    onSelect(null, null)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 0, textAlign: 'left', width: '100%', fontSize: 12,
          color: current ? 'var(--txt)' : 'var(--txt-3)',
          fontWeight: current ? 500 : 400,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? current.nom : <span style={{ opacity: 0.45 }}>Fournisseur…</span>}
        </span>
        {current && (
          <span
            onClick={clear}
            title="Retirer"
            style={{ fontSize: 10, color: 'var(--txt-3)', lineHeight: 1, flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
            ×
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: -8,
          zIndex: 200, width: 220,
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.18)',
          overflow: 'hidden',
        }}>
          {/* Recherche */}
          <div style={{ padding: '7px 8px', borderBottom: '1px solid var(--brd-sub)' }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher ou créer…"
              onKeyDown={e => {
                if (e.key === 'Enter') { if (!hasExact && query.trim()) createAndPick(); else if (filtered[0]) pick(filtered[0]) }
                if (e.key === 'Escape') setOpen(false)
              }}
              style={{
                width: '100%', background: 'var(--bg-elev)',
                border: '1px solid var(--brd)', borderRadius: 6,
                color: 'var(--txt)', fontSize: 11,
                padding: '4px 8px', outline: 'none',
              }}
            />
          </div>

          {/* Toggle bulk — AU-DESSUS de la liste pour rester visible */}
          {otherEmptyInBloc > 0 && (
            <label
              onClick={(e) => { e.stopPropagation(); setBulk(b => !b); inputRef.current?.focus() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', cursor: 'pointer',
                borderBottom: '1px solid var(--brd-sub)',
                background: bulk ? 'rgba(0,122,255,.12)' : 'var(--bg-elev)',
                fontSize: 11, color: bulk ? 'var(--blue)' : 'var(--txt-3)',
                fontWeight: bulk ? 600 : 500,
                userSelect: 'none',
              }}>
              <span style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${bulk ? 'var(--blue)' : 'var(--txt-3)'}`,
                background: bulk ? 'var(--blue)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 10, fontWeight: 800, lineHeight: 1,
              }}>
                {bulk && '✓'}
              </span>
              <span>
                Appliquer aux <strong>{otherEmptyInBloc} {otherEmptyInBloc === 1 ? 'autre ligne vide' : 'autres lignes vides'}</strong> du bloc
              </span>
            </label>
          )}

          {/* Liste */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 && !query && (
              <p style={{ fontSize: 10, color: 'var(--txt-3)', padding: '10px', textAlign: 'center' }}>
                Aucun fournisseur — saisissez un nom
              </p>
            )}
            {filtered.map(f => (
              <button key={f.id} onClick={() => pick(f)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 10px', fontSize: 12, fontWeight: 500,
                  background: f.id === fournisseurId ? 'rgba(0,122,255,.08)' : 'transparent',
                  color: f.id === fournisseurId ? 'var(--blue)' : 'var(--txt)',
                  border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (f.id !== fournisseurId) e.currentTarget.style.background = 'var(--bg-elev)' }}
                onMouseLeave={e => { if (f.id !== fournisseurId) e.currentTarget.style.background = 'transparent' }}>
                {f.nom}
                {f.type && <span style={{ fontSize: 9, color: 'var(--txt-3)', marginLeft: 6 }}>{f.type}</span>}
              </button>
            ))}
            {query.trim() && !hasExact && (
              <button onClick={createAndPick}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 10px', fontSize: 12, fontWeight: 600,
                  background: 'transparent', color: 'var(--blue)',
                  border: 'none', cursor: 'pointer',
                  borderTop: filtered.length > 0 ? '1px solid var(--brd-sub)' : 'none',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,122,255,.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                + Créer « {query.trim()} »
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InlineNumberInput({ value, onChange, style }) {
  const [v, setV] = useState(String(value || 0))
  useEffect(() => setV(String(value || 0)), [value])
  return (
    <input type="number" value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => { const n = parseFloat(v); if (!isNaN(n) && n !== value) onChange(n) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      style={{ background: 'transparent', border: 'none', outline: 'none', textAlign: 'right', width: 80, ...style }}
      step="0.01" />
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// RÉCAP PAIEMENTS
// ══════════════════════════════════════════════════════════════════════════════
function RecapPaiements({
  lines, membres, reel, reelByLine, membreByLine, fournisseurs,
  onSaveGroupTotal, onSaveGroupPaid, onSaveGroupTva,
  onSaveFournisseurGroupTotal, onSaveFournisseurGroupPaid, onSaveFournisseurGroupTva,
}) {
  const fournisseurMap = Object.fromEntries((fournisseurs || []).map(f => [f.id, f]))
  // ─── Groupes Personnes ─────────────────────────────────────────────────────
  const personGroups = (() => {
    const groups = new Map()
    for (const line of lines) {
      if (!CATS_HUMAINS.includes(line.regime)) continue
      const m = membreByLine[line.id]
      if (!m) continue
      const key = m.contact_id ? `c:${m.contact_id}` : `n:${m.prenom}|${m.nom}`
      if (!groups.has(key)) {
        groups.set(key, { key, name: memberName(m), lineIds: [], postes: [], coutPrevus: [] })
      }
      const g = groups.get(key)
      g.lineIds.push(line.id)
      g.postes.push(line.produit || '—')
      g.coutPrevus.push(refCout(line, m))
    }
    return [...groups.values()]
  })()

  // ─── Groupes Fournisseurs ──────────────────────────────────────────────────
  // Lignes liées à un fournisseur via devis_lines.fournisseur_id
  // + additifs avec fournisseur texte (backward compat)
  const fournisseurGroups = (() => {
    const groups = new Map()
    const personLineIds = new Set(personGroups.flatMap(g => g.lineIds))
    for (const line of lines) {
      if (personLineIds.has(line.id)) continue
      const fId = line.fournisseur_id
      if (!fId) continue
      const f = fournisseurMap[fId]
      if (!f) continue
      const cp = refCout(line, membreByLine[line.id])
      if (!groups.has(fId)) groups.set(fId, { key: fId, nom: f.nom, items: [] })
      groups.get(fId).items.push({ id: line.id, isAdditif: false, label: line.produit || '—', entry: reelByLine[line.id], coutPrevu: cp })
    }
    // Additifs avec fournisseur texte libre (non lié à la table fournisseurs)
    for (const a of reel.filter(r => r.is_additif && r.fournisseur?.trim())) {
      const f = a.fournisseur.trim()
      const textKey = `text:${f}`
      if (!groups.has(textKey)) groups.set(textKey, { key: textKey, nom: f, items: [] })
      groups.get(textKey).items.push({ id: a.id, isAdditif: true, label: a.description || f, entry: a })
    }
    return [...groups.values()]
  })()

  if (personGroups.length === 0 && fournisseurGroups.length === 0) return null

  return (
    <div className="mt-2 space-y-6 pb-6">
      <div className="flex items-center gap-3 pt-4" style={{ borderTop: '2px solid var(--brd)' }}>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--txt-3)' }}>
          Récap Paiements
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--brd)' }} />
      </div>

      {/* Personnes */}
      {personGroups.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--purple)' }}>
            Personnes
          </p>
          {personGroups.map(g => (
            <PersonGroupCard
              key={g.key}
              group={g}
              reelByLine={reelByLine}
              onSaveGroupTotal={onSaveGroupTotal}
              onSaveGroupPaid={onSaveGroupPaid}
              onSaveGroupTva={onSaveGroupTva}
            />
          ))}
        </div>
      )}

      {/* Fournisseurs */}
      {fournisseurGroups.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--amber)' }}>
            Fournisseurs
          </p>
          {fournisseurGroups.map(g => (
            <FournisseurGroupCard
              key={g.key}
              group={g}
              onSaveFournisseurGroupTotal={onSaveFournisseurGroupTotal}
              onSaveFournisseurGroupPaid={onSaveFournisseurGroupPaid}
              onSaveFournisseurGroupTva={onSaveFournisseurGroupTva}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Carte Groupe Personne ──────────────────────────────────────────────────
function PersonGroupCard({ group, reelByLine, onSaveGroupTotal, onSaveGroupPaid, onSaveGroupTva }) {
  const { name, lineIds, postes, coutPrevus } = group
  const inputRef = useRef(null)
  const [editing, setEditing]   = useState(false)
  const [totalVal, setTotalVal] = useState('')

  const totalPrevu   = coutPrevus.reduce((s, c) => s + c, 0)
  const currentReels = lineIds.map((id, i) => reelByLine[id]?.montant_ht ?? coutPrevus[i])
  const totalReel    = currentReels.reduce((s, v) => s + v, 0)
  const allPaid      = lineIds.length > 0 && lineIds.every(id => reelByLine[id]?.paye)
  const ecart        = totalReel - totalPrevu

  // TVA commune au groupe : si toutes les entrées partagent le même taux on l'affiche,
  // sinon on prend la première (l'utilisateur peut la propager via le picker)
  const tvaRates = lineIds.map(id => reelByLine[id]?.tva_rate).filter(v => v != null)
  const groupTva = tvaRates.length > 0 ? tvaRates[0] : 0
  const tvaMixed = tvaRates.length > 1 && tvaRates.some(v => v !== groupTva)

  // Dédoublonne les postes en comptant les occurrences (même nom de poste = ×N)
  const posteCounts = postes.reduce((acc, p) => {
    acc[p] = (acc[p] || 0) + 1
    return acc
  }, {})
  const uniquePostes = Object.entries(posteCounts)   // [[name, count], …]

  function startEdit() {
    setTotalVal(String(Math.round(totalReel * 100) / 100))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    const v = parseFloat(totalVal)
    if (!isNaN(v)) onSaveGroupTotal(lineIds, coutPrevus, v)
    setEditing(false)
  }

  return (
    <div className="rounded-xl px-4 py-3"
      style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}>
      <div className="flex items-start gap-4">
        {/* Infos */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>{name || '—'}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {uniquePostes.map(([p, n]) => (
              <span key={p} style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                background: 'rgba(156,95,253,.1)', color: 'var(--purple)',
              }}>
                {p}{n > 1 && <span style={{ opacity: 0.7, marginLeft: 4 }}>× {n}</span>}
              </span>
            ))}
          </div>
        </div>

        {/* Chiffres */}
        <div className="flex items-center gap-5 shrink-0">
          {/* Prévu */}
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>Prévu</p>
            <p className="font-semibold tabular-nums text-sm" style={{ color: 'var(--amber)' }}>{fmtEur(totalPrevu)}</p>
          </div>

          {/* Réel total — cliquable pour éditer */}
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>
              Réel total {lineIds.length > 1 ? `(${lineIds.length} postes)` : ''}
            </p>
            {editing ? (
              <input
                ref={inputRef}
                type="number"
                value={totalVal}
                onChange={e => setTotalVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
                style={{
                  width: 100, textAlign: 'right',
                  background: 'var(--bg-elev)', border: '1px solid var(--purple)',
                  borderRadius: 6, color: 'var(--txt)', padding: '2px 6px',
                  fontSize: 13, fontWeight: 700, outline: 'none',
                }}
                step="0.01" placeholder="0.00"
              />
            ) : (
              <p
                className="font-bold tabular-nums text-sm cursor-text"
                onClick={startEdit}
                title="Cliquer pour saisir le total réel — distribué proportionnellement"
                style={{ color: Math.abs(ecart) < 0.01 ? 'var(--txt)' : ecart > 0 ? 'var(--red)' : 'var(--green)' }}>
                {fmtEur(totalReel)}
                {Math.abs(ecart) > 0.01 && (
                  <span style={{ fontSize: 9, display: 'block', opacity: 0.75 }}>
                    {ecart > 0 ? '+' : ''}{fmtEur(ecart)} vs prévu
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Payé */}
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: 'var(--txt-3)' }}>Payé</p>
            <Checkbox
              checked={allPaid}
              onChange={v => onSaveGroupPaid(lineIds, v)}
              color="green"
            />
          </div>
        </div>
      </div>

      {/* Ligne TVA — propage à toutes les entrées du groupe */}
      <div className="mt-2 pt-2 flex items-center justify-between gap-3"
        style={{ borderTop: '1px solid var(--brd-sub)' }}>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
          TVA {tvaMixed && <span style={{ color: 'var(--amber)' }}>· mixte</span>}
        </span>
        <TvaPicker
          value={groupTva}
          onChange={v => onSaveGroupTva(lineIds, v)}
          label={null}
          compact
        />
      </div>

      {/* Détail par poste si plusieurs lignes — index #N quand un même poste se répète */}
      {lineIds.length > 1 && (() => {
        // Indice cumulatif par nom de poste pour distinguer "Directeur de production #1 / #2"
        const seen = {}
        return (
          <div className="mt-2 pt-2 space-y-0.5" style={{ borderTop: '1px solid var(--brd-sub)' }}>
            {lineIds.map((id, i) => {
              const r    = reelByLine[id]?.montant_ht ?? coutPrevus[i]
              const paid = reelByLine[id]?.paye
              const name = postes[i]
              const total = posteCounts[name]
              seen[name] = (seen[name] || 0) + 1
              const label = total > 1 ? `${name} #${seen[name]}` : name
              return (
                <div key={id} className="flex items-center gap-2">
                  <span style={{ color: paid ? 'var(--green)' : 'var(--txt-3)', fontSize: 10, flex: 1 }}>
                    {paid ? '✓ ' : ''}{label}
                  </span>
                  <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>{fmtEur(coutPrevus[i])} prévu</span>
                  <span style={{ color: 'var(--txt)', fontSize: 10, fontWeight: 600, minWidth: 65, textAlign: 'right' }}>{fmtEur(r)}</span>
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}

// ─── Carte Groupe Fournisseur ───────────────────────────────────────────────
function FournisseurGroupCard({ group, onSaveFournisseurGroupTotal, onSaveFournisseurGroupPaid, onSaveFournisseurGroupTva }) {
  const { nom: fournisseur, items } = group   // ← nom, pas key
  const inputRef = useRef(null)
  const [editing,      setEditing]      = useState(false)
  const [totalVal,     setTotalVal]     = useState('')
  const [pendingTotal, setPendingTotal] = useState(null)  // total optimiste local

  const totalReel  = items.reduce((s, it) => s + (it.entry?.montant_ht || 0), 0)
  const totalPrevu = items.reduce((s, it) => s + (it.coutPrevu || 0), 0)
  const allPaid    = items.length > 0 && items.every(it => it.entry?.paye)
  const isAllAdditif = items.length > 0 && items.every(it => it.isAdditif)

  // TVA commune au groupe (idem PersonGroupCard)
  const tvaRates = items.map(it => it.entry?.tva_rate).filter(v => v != null)
  const groupTva = tvaRates.length > 0 ? tvaRates[0] : 20
  const tvaMixed = tvaRates.length > 1 && tvaRates.some(v => v !== groupTva)

  // Uniquement les entrées confirmées par la DB (id réel, pas temporaire)
  const totalConfirme = items.reduce((s, it) => {
    if (!it.entry || String(it.entry.id).startsWith('__tmp_')) return s
    return s + (it.entry.montant_ht || 0)
  }, 0)

  // On abandonne le pendingTotal seulement quand la DB confirme (id réel)
  useEffect(() => {
    if (pendingTotal !== null && totalConfirme > 0) setPendingTotal(null)
  }, [totalConfirme])

  const displayTotal = pendingTotal !== null ? pendingTotal : totalReel

  function startEdit() {
    setTotalVal(displayTotal > 0 ? String(Math.round(displayTotal * 100) / 100) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  function commitEdit() {
    const v = parseFloat(totalVal)
    if (!isNaN(v) && v > 0) {
      setPendingTotal(v)       // affiche immédiatement, sans attendre la DB
      onSaveFournisseurGroupTotal(items, v)
    }
    setEditing(false)
  }

  return (
    <div className="rounded-xl px-4 py-3"
      style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}>
      <div className="flex items-start gap-4">
        {/* Infos */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>{fournisseur}</p>
            {isAllAdditif && (
              <span style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                background: 'rgba(255,87,87,.12)', color: 'var(--red)',
                letterSpacing: '.05em', textTransform: 'uppercase',
                border: '1px solid rgba(255,87,87,.3)',
              }}>
                Additif
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {items.map((it, i) => (
              <span key={i} style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                background: it.isAdditif ? 'rgba(255,87,87,.1)' : 'rgba(255,174,0,.1)',
                color: it.isAdditif ? 'var(--red)' : 'var(--amber)',
              }}>
                {it.isAdditif && <span style={{ opacity: 0.75, marginRight: 3 }}>+</span>}
                {it.label}
              </span>
            ))}
          </div>
        </div>

        {/* Chiffres */}
        <div className="flex items-center gap-5 shrink-0">

          {/* Coût prévu */}
          {totalPrevu > 0 && (
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>Budget prévu</p>
              <p className="font-semibold tabular-nums text-sm" style={{ color: 'var(--amber)' }}>{fmtEur(totalPrevu)}</p>
            </div>
          )}

          {/* Montant facture — bouton d'édition bien visible */}
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: 'var(--txt-3)' }}>
              Montant facture {items.length > 1 ? `(${items.length} lignes)` : ''}
            </p>
            {editing ? (
              <input
                ref={inputRef}
                type="number"
                value={totalVal}
                onChange={e => setTotalVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
                autoFocus
                style={{
                  width: 110, textAlign: 'right',
                  background: 'var(--bg-elev)', border: '1px solid var(--amber)',
                  borderRadius: 6, color: 'var(--txt)', padding: '3px 8px',
                  fontSize: 13, fontWeight: 700, outline: 'none',
                }}
                step="0.01" placeholder="0.00"
              />
            ) : displayTotal > 0 ? (
              <p className="font-bold tabular-nums text-sm cursor-text"
                onClick={startEdit}
                style={{ color: totalPrevu > 0 && Math.abs(displayTotal - totalPrevu) < 0.01
                  ? 'var(--txt)'
                  : displayTotal > totalPrevu ? 'var(--red)' : 'var(--green)' }}>
                {fmtEur(displayTotal)}
                {totalPrevu > 0 && Math.abs(displayTotal - totalPrevu) > 0.01 && (
                  <span style={{ fontSize: 9, display: 'block', opacity: 0.75 }}>
                    {displayTotal > totalPrevu ? '+' : ''}{fmtEur(displayTotal - totalPrevu)} vs prévu
                  </span>
                )}
              </p>
            ) : (
              /* Bouton visible quand pas encore saisi */
              <button
                onClick={startEdit}
                style={{
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  color: 'var(--amber)', background: 'rgba(255,174,0,.1)',
                  border: '1px dashed rgba(255,174,0,.4)',
                  borderRadius: 6, padding: '3px 10px',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,174,0,.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,174,0,.1)'}>
                Saisir montant
              </button>
            )}
          </div>

          {/* Payé */}
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wide mb-1" style={{ color: 'var(--txt-3)' }}>Payé</p>
            <Checkbox
              checked={allPaid}
              onChange={v => onSaveFournisseurGroupPaid(items, v)}
              color="green"
            />
          </div>
        </div>
      </div>

      {/* Ligne TVA — propage à toutes les entrées du groupe */}
      <div className="mt-2 pt-2 flex items-center justify-between gap-3"
        style={{ borderTop: '1px solid var(--brd-sub)' }}>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
          TVA {tvaMixed && <span style={{ color: 'var(--amber)' }}>· mixte</span>}
        </span>
        <TvaPicker
          value={groupTva}
          onChange={v => onSaveFournisseurGroupTva(items, v)}
          label={null}
          compact
        />
      </div>

      {/* Détail par ligne si plusieurs */}
      {items.length > 1 && (
        <div className="mt-2 pt-2 space-y-0.5" style={{ borderTop: '1px solid var(--brd-sub)' }}>
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <span style={{ color: it.entry?.paye ? 'var(--green)' : 'var(--txt-3)', fontSize: 10, flex: 1 }}>
                {it.entry?.paye ? '✓ ' : ''}{it.label}
                {it.isAdditif && <span style={{ opacity: 0.5 }}> (additif)</span>}
              </span>
              <span style={{ color: 'var(--txt)', fontSize: 10, fontWeight: 600, minWidth: 70, textAlign: 'right' }}>
                {it.entry?.montant_ht ? fmtEur(it.entry.montant_ht) : <span style={{ opacity: 0.3 }}>— en attente</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Badge régime coloré — rappel visuel du type de dépense par ligne
function RegimeBadge({ regime }) {
  const r = (regime || '').toLowerCase()
  const style = r.includes('intermittent')
    ? { color: 'var(--purple)', bg: 'rgba(156,95,253,.1)' }
    : r === 'interne'
    ? { color: 'var(--blue)',   bg: 'rgba(0,122,255,.1)'  }
    : r === 'externe'
    ? { color: 'var(--green)',  bg: 'rgba(0,200,117,.1)'  }
    : r === 'technique'
    ? { color: 'var(--amber)',  bg: 'rgba(255,174,0,.1)'  }
    : r === 'frais'
    ? { color: 'var(--txt-3)', bg: 'var(--bg-elev)'       }
    : { color: 'var(--txt-3)', bg: 'var(--bg-elev)'       }

  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9,
      fontWeight: 600,
      padding: '1px 5px',
      borderRadius: 4,
      background: style.bg,
      color: style.color,
      letterSpacing: '0.03em',
    }}>
      {regime}
    </span>
  )
}

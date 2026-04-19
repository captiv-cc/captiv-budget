/**
 * Budget Réel v2 — multi-lot (Chantier 5)
 * ─ Chaque ligne du devis = une ligne de suivi (pas de re-saisie)
 * ─ Prestataire = membre de l'Équipe (projet_membres.devis_line_id)
 * ─ Coût prévu  = budget_convenu Équipe (tarif négocié) si défini,
 *                 sinon calcLine(devis_line).coutCharge
 * ─ Coût réel   = saisie inline → budget_reel entry (upsert)
 * ─ ADDITIFS par bloc pour dépenses hors-devis (lot_id injecté à la création)
 * ─ TVA 0 / 5,5 / 10 / 20 %, Validé, Payé par ligne
 * ─ Totaux par bloc + KPIs globaux + KPIs par lot
 * ─ Multi-lot : un accordéon par lot (refDevis propre à chaque lot).
 *   Additifs orphelins (lot_id IS NULL, legacy) regroupés dans « Hors lot ».
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useProjet } from '../ProjetLayout'
import { supabase } from '../../lib/supabase'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { OUTILS, ACTIONS } from '../../lib/permissions'
import { calcLine, calcSynthese, CATS_HUMAINS, TAUX_DEFAUT, fmtEur } from '../../lib/cotisations'
import { getBlocInfo } from '../../lib/blocs'
import { Check, ChevronDown, ChevronRight, Plus, Package } from 'lucide-react'
import { isIntermittentLike, refCout, memberName } from '../../features/budget-reel/utils'
import { Th } from '../../features/budget-reel/components/atoms'
import KpiBar from '../../features/budget-reel/components/KpiBar'
import LotScopeSelector from '../../components/LotScopeSelector'
import FiltersBar from '../../features/budget-reel/components/FiltersBar'
import BlocFooter from '../../features/budget-reel/components/BlocFooter'
import LineRow from '../../features/budget-reel/components/LineRow'
import AdditifRow from '../../features/budget-reel/components/AdditifRow'
import RecapPaiements from '../../features/budget-reel/components/RecapPaiements'

// ── Palette déterministe alignée avec FacturesTab/DevisTab ─────────────────
const LOT_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#f97316', '#14b8a6',
]
function lotColor(lotId, orderedLots) {
  if (!lotId) return 'var(--txt-3)'
  const idx = orderedLots.findIndex((l) => l.id === lotId)
  return LOT_PALETTE[((idx >= 0 ? idx : 0) + LOT_PALETTE.length) % LOT_PALETTE.length]
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function BudgetReelTab() {
  const { project, projectId, lots, refDevisByLot } = useProjet()
  // BUDGET-PERM (2026-04-20) — gating granulaire via l'outil 'budget' (partagé
  // avec Factures + Dashboard). `canRead` ouvre la page, `canEdit` verrouille
  // toutes les saisies (coût réel, validation, TVA, additifs, fournisseurs).
  const { loading: permLoading, can: canDo } = useProjectPermissions(projectId)
  const canRead = canDo(OUTILS.BUDGET, ACTIONS.READ)
  const canEdit = canDo(OUTILS.BUDGET, ACTIONS.EDIT)

  // Lots actifs triés (non archivés) — base de l'affichage multi-lot
  const activeLots = useMemo(
    () => (lots || []).filter((l) => !l.archived),
    [lots],
  )
  // Lots avec un refDevis (ceux où on peut charger cats/lines)
  const lotsWithRef = useMemo(
    () => activeLots.filter((l) => refDevisByLot?.[l.id]),
    [activeLots, refDevisByLot],
  )
  const isMultiLot = lotsWithRef.length > 1
  // IDs des devis de référence (un par lot signé)
  const refDevisIds = useMemo(
    () => lotsWithRef.map((l) => refDevisByLot[l.id].id),
    [lotsWithRef, refDevisByLot],
  )

  // ── State serveur ─────────────────────────────────────────────────────────
  const [cats, setCats] = useState([])
  const [lines, setLines] = useState([])
  const [membres, setMembres] = useState([])
  const [reel, setReel] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [blocTermine, setBlocTermine] = useState({})

  // ── Persistance des states de pliage (par projet) ─────────────────────────
  const collapseStorageKey = `budgetReel.collapsedBlocs.${projectId || 'noproj'}`
  const [blocCollapsed, setBlocCollapsed] = useState(() => {
    try {
      const raw =
        typeof window !== 'undefined' ? window.localStorage.getItem(collapseStorageKey) : null
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(collapseStorageKey, JSON.stringify(blocCollapsed))
    } catch {
      /* ignore */
    }
  }, [blocCollapsed, collapseStorageKey])
  const toggleBlocCollapsed = (catId) => setBlocCollapsed((p) => ({ ...p, [catId]: !p[catId] }))

  // Collapse lots (uniquement en multi-lot, sinon tout ouvert)
  const lotCollapseStorageKey = `budgetReel.collapsedLots.${projectId || 'noproj'}`
  const [lotCollapsed, setLotCollapsed] = useState(() => {
    try {
      const raw =
        typeof window !== 'undefined' ? window.localStorage.getItem(lotCollapseStorageKey) : null
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(lotCollapseStorageKey, JSON.stringify(lotCollapsed))
    } catch {
      /* ignore */
    }
  }, [lotCollapsed, lotCollapseStorageKey])
  const toggleLotCollapsed = (lotId) =>
    setLotCollapsed((p) => ({ ...p, [lotId]: !p[lotId] }))

  // ── Scope KpiBar ('__all__' = somme de tous les lots, lotId = lot unique) ──
  const [kpiScope, setKpiScope] = useState('__all__')
  useEffect(() => {
    if (kpiScope === '__all__') return
    if (!lotsWithRef.some((l) => l.id === kpiScope)) setKpiScope('__all__')
  }, [kpiScope, lotsWithRef])

  // ── Filtres rapides (globaux à tous les lots) ─────────────────────────────
  const [filters, setFilters] = useState({
    estimees: false,
    nonPayees: false,
    ecart: false,
    additifs: false,
  })
  const toggleFilter = (k) => setFilters((f) => ({ ...f, [k]: !f[k] }))
  const clearFilters = () =>
    setFilters({ estimees: false, nonPayees: false, ecart: false, additifs: false })
  const anyFilter = filters.estimees || filters.nonPayees || filters.ecart || filters.additifs

  // ── Chargement ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!projectId || refDevisIds.length === 0) {
      setCats([])
      setLines([])
      setMembres([])
      setReel([])
      setFournisseurs([])
      setLoading(false)
      return
    }
    setLoading(true)
    const [cR, lR, mR, rR, fR] = await Promise.all([
      supabase
        .from('devis_categories')
        .select('*')
        .in('devis_id', refDevisIds)
        .order('sort_order'),
      supabase
        .from('devis_lines')
        .select('*')
        .in('devis_id', refDevisIds)
        .order('sort_order'),
      supabase
        .from('projet_membres')
        .select('*, contact:contacts(nom, prenom, default_tva)')
        .eq('project_id', projectId),
      supabase.from('budget_reel').select('*').eq('project_id', projectId),
      supabase.from('fournisseurs').select('*').eq('org_id', project.org_id).order('nom'),
    ])
    setCats(cR.data || [])
    setLines(lR.data || [])
    setMembres(mR.data || [])
    setReel(rR.data || [])
    setFournisseurs(fR.data || [])
    setLoading(false)
  }, [projectId, refDevisIds, project?.org_id])

  useEffect(() => {
    load()
  }, [load])

  // ── Maps dérivées ─────────────────────────────────────────────────────────

  const reelByLine = useMemo(
    () =>
      Object.fromEntries(
        reel.filter((r) => r.devis_line_id && !r.is_additif).map((r) => [r.devis_line_id, r]),
      ),
    [reel],
  )
  const membreByLine = useMemo(
    () =>
      Object.fromEntries(
        membres.filter((m) => m.devis_line_id).map((m) => [m.devis_line_id, m]),
      ),
    [membres],
  )
  // devisId → lotId (pour retrouver le lot d'une catégorie/ligne)
  const lotIdByDevisId = useMemo(() => {
    const map = {}
    for (const lot of lotsWithRef) map[refDevisByLot[lot.id].id] = lot.id
    return map
  }, [lotsWithRef, refDevisByLot])

  // lotId → { title, color } pour les badges de lot (RecapPaiements, etc.)
  const lotInfoMap = useMemo(() => {
    const map = {}
    for (const lot of lotsWithRef) {
      map[lot.id] = { title: lot.title, color: lotColor(lot.id, lotsWithRef) }
    }
    map.__orphan__ = { title: 'Hors lot', color: '#94a3b8' }
    return map
  }, [lotsWithRef])

  // cats/lines regroupées par lot (pour le rendu par accordéon)
  const catsByLot = useMemo(() => {
    const map = {}
    for (const c of cats) {
      const lotId = lotIdByDevisId[c.devis_id]
      if (!lotId) continue
      if (!map[lotId]) map[lotId] = []
      map[lotId].push(c)
    }
    return map
  }, [cats, lotIdByDevisId])

  const linesByLot = useMemo(() => {
    const map = {}
    for (const l of lines) {
      const lotId = lotIdByDevisId[l.devis_id]
      if (!lotId) continue
      if (!map[lotId]) map[lotId] = []
      map[lotId].push(l)
    }
    return map
  }, [lines, lotIdByDevisId])

  // Additifs : groupés par lot_id direct (colonne DB) ; lot_id IS NULL → orphelins
  const additifsByLot = useMemo(() => {
    const map = {}
    for (const r of reel) {
      if (!r.is_additif) continue
      const key = r.lot_id || '__orphan__'
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    return map
  }, [reel])
  const orphanAdditifs = additifsByLot.__orphan__ || []

  // ── Filtres : une ligne passe si tous les filtres actifs sont satisfaits ─
  const lineMatchesFilters = useCallback(
    (line) => {
      if (!anyFilter) return true
      const e = reelByLine[line.id]
      const cp = refCout(line, membreByLine[line.id])
      const isEstimee = !e || e.montant_ht == null
      if (filters.additifs) return false // "Additifs" exclut les lignes devis
      if (filters.estimees && !isEstimee) return false
      if (filters.nonPayees && (isEstimee || e?.paye)) return false
      if (filters.ecart) {
        if (isEstimee || cp <= 0) return false
        const ratio = Math.abs(e.montant_ht - cp) / cp
        if (ratio <= 0.1) return false
      }
      return true
    },
    [anyFilter, filters, reelByLine, membreByLine],
  )
  const additifMatchesFilters = useCallback(
    (a) => {
      if (!anyFilter) return true
      if (filters.additifs) {
        if (filters.nonPayees && a.paye) return false
        return true
      }
      return false
    },
    [anyFilter, filters],
  )

  // ── Mutations ─────────────────────────────────────────────────────────────

  function defaultTvaForLine(line) {
    if (!line) return 0
    const m = membreByLine[line.id]
    if (m && m.contact && Number.isFinite(Number(m.contact?.default_tva))) {
      return Number(m.contact.default_tva)
    }
    if (line.fournisseur_id) {
      const f = fournisseurs.find((x) => x.id === line.fournisseur_id)
      if (f && Number.isFinite(Number(f?.default_tva))) return Number(f.default_tva)
    }
    return 0
  }

  function withAutoValide(fields, existing) {
    const next = { ...fields }
    const alreadyValide = existing?.valide === true
    const setsAmount = Object.prototype.hasOwnProperty.call(fields, 'montant_ht')
    const setsPaye = fields.paye === true
    if (!alreadyValide && next.valide !== false && (setsAmount || setsPaye)) {
      next.valide = true
    }
    return next
  }

  async function saveLineReel(lineId, fieldsRaw) {
    // BUDGET-PERM — sans droit édition, no-op (la RLS bloquerait de toute façon)
    if (!canEdit) return
    const existing = reelByLine[lineId]
    const fields = withAutoValide(fieldsRaw, existing)
    if (existing && !String(existing.id).startsWith('__tmp_')) {
      const upd = { ...existing, ...fields }
      setReel((p) => p.map((r) => (r.id === existing.id ? upd : r)))
      const { error } = await supabase.from('budget_reel').update(fields).eq('id', existing.id)
      if (error) {
        console.error('[BudgetRéel] update:', error.message)
        setReel((p) => p.map((r) => (r.id === existing.id ? existing : r)))
      }
    } else {
      const line = lines.find((l) => l.id === lineId)
      const cat = cats.find((c) => c.id === line?.category_id)
      const lotId = lotIdByDevisId[line?.devis_id] || null
      const payload = {
        project_id: projectId,
        devis_line_id: lineId,
        lot_id: lotId, // ← nouveau : synchronise avec le lot du devis parent
        bloc_name: cat?.name ?? '',
        montant_ht: 0,
        tva_rate: defaultTvaForLine(line),
        valide: false,
        paye: false,
        is_additif: false,
        description: line?.produit || '',
        ...fields,
      }
      const tempId = `__tmp_${lineId}`
      setReel((p) => [...p.filter((r) => r.id !== tempId), { ...payload, id: tempId }])

      const { data, error } = await supabase.from('budget_reel').insert(payload).select().single()

      if (!error && data) {
        setReel((p) => p.map((r) => (r.id === tempId ? data : r)))
        return
      }

      console.warn('[BudgetRéel] insert failed, trying fallback:', error?.message)
      const { data: found } = await supabase
        .from('budget_reel')
        .select('*')
        .eq('project_id', projectId)
        .eq('devis_line_id', lineId)
        .eq('is_additif', false)
        .maybeSingle()

      if (found) {
        const upd = { ...found, ...fields }
        setReel((p) => p.map((r) => (r.id === tempId ? upd : r)))
        await supabase.from('budget_reel').update(fields).eq('id', found.id)
        setReel((p) => p.map((r) => (r.id === tempId ? { ...upd, id: found.id } : r)))
      } else {
        console.error('[BudgetRéel] échec définitif:', error?.message)
        setReel((p) => p.filter((r) => r.id !== tempId))
      }
    }
  }

  async function clearLineReel(lineId) {
    if (!canEdit) return
    const existing = reelByLine[lineId]
    if (!existing) return
    setReel((p) => p.filter((r) => r.id !== existing.id))
    if (String(existing.id).startsWith('__tmp_')) return
    const { error } = await supabase.from('budget_reel').delete().eq('id', existing.id)
    if (error) {
      console.error('[BudgetRéel] clear:', error.message)
      setReel((p) => [...p, existing])
    }
  }

  async function confirmLineAtPrevu(lineId) {
    if (!canEdit) return
    const line = lines.find((l) => l.id === lineId)
    if (!line) return
    const cp = refCout(line, membreByLine[lineId])
    await saveLineReel(lineId, { montant_ht: cp })
  }

  async function confirmBlocAtPrevu(catId) {
    if (!canEdit) return
    const targets = lines
      .filter((l) => l.category_id === catId)
      .filter((l) => {
        const e = reelByLine[l.id]
        return !e || e.montant_ht == null
      })
    for (const l of targets) {
      const cp = refCout(l, membreByLine[l.id])
      await saveLineReel(l.id, { montant_ht: cp })
    }
  }

  // Un additif est créé depuis un bloc (catId) → on récupère le lot_id via le devis du bloc
  async function addAdditif(catId) {
    if (!canEdit) return
    const cat = cats.find((c) => c.id === catId)
    const lotId = lotIdByDevisId[cat?.devis_id] || null
    const { data } = await supabase
      .from('budget_reel')
      .insert({
        project_id: projectId,
        lot_id: lotId,
        bloc_name: cat?.name || '',
        montant_ht: 0,
        tva_rate: 0,
        valide: false,
        paye: false,
        qonto_ok: false,
        is_additif: true,
        description: '',
        fournisseur: '',
      })
      .select()
      .single()
    if (data) setReel((p) => [...p, data])
  }

  async function updateAdditif(id, fieldsRaw) {
    if (!canEdit) return
    const existing = reel.find((r) => r.id === id)
    const fields = withAutoValide(fieldsRaw, existing)
    setReel((p) => p.map((r) => (r.id === id ? { ...r, ...fields } : r)))
    await supabase.from('budget_reel').update(fields).eq('id', id)
  }

  async function deleteAdditif(id) {
    if (!canEdit) return
    if (!confirm('Supprimer cet additif ?')) return
    await supabase.from('budget_reel').delete().eq('id', id)
    setReel((p) => p.filter((r) => r.id !== id))
  }

  async function saveGroupTotal(lineIds, coutPrevus, totalReel) {
    const totalPrevu = coutPrevus.reduce((s, c) => s + c, 0)
    for (let i = 0; i < lineIds.length; i++) {
      const prop = totalPrevu > 0 ? coutPrevus[i] / totalPrevu : 1 / lineIds.length
      const amount = Math.round(totalReel * prop * 100) / 100
      await saveLineReel(lineIds[i], { montant_ht: amount })
    }
  }

  async function saveGroupPaid(lineIds, paid) {
    for (const id of lineIds) {
      const e = reelByLine[id]
      if (e) {
        await saveLineReel(id, { paye: paid })
      } else if (paid) {
        const line = lines.find((l) => l.id === id)
        const m = membreByLine[id]
        const cp = line ? refCout(line, m) : 0
        await saveLineReel(id, { paye: true, montant_ht: cp })
      }
    }
  }

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

  async function saveGroupTva(lineIds, tva) {
    for (const id of lineIds) {
      const e = reelByLine[id]
      if (e) {
        await saveLineReel(id, { tva_rate: tva })
      } else {
        const line = lines.find((l) => l.id === id)
        const m = membreByLine[id]
        const cp = line ? refCout(line, m) : 0
        await saveLineReel(id, { tva_rate: tva, montant_ht: cp })
      }
    }
  }

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

  async function saveFournisseurGroupTotal(items, totalReel) {
    const weights = items.map(
      (item) => (item.isAdditif ? item.entry?.montant_ht || 1 : item.coutPrevu || 1),
    )
    const totalW = weights.reduce((s, w) => s + w, 0)
    for (let i = 0; i < items.length; i++) {
      const prop = totalW > 0 ? weights[i] / totalW : 1 / items.length
      const amount = Math.round(totalReel * prop * 100) / 100
      if (items[i].isAdditif) {
        await updateAdditif(items[i].id, { montant_ht: amount })
      } else {
        await saveLineReel(items[i].id, { montant_ht: amount })
      }
    }
  }

  async function applyFournisseurToBloc(currentLineId, fournisseurId, nomNouveau) {
    if (!canEdit) return
    let fId = fournisseurId
    if (!fId && nomNouveau) {
      const { data, error } = await supabase
        .from('fournisseurs')
        .insert({ nom: nomNouveau, org_id: project.org_id })
        .select()
        .single()
      if (error) {
        console.error('[Fournisseur] create:', error)
        return
      }
      setFournisseurs((p) => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom)))
      fId = data.id
    }
    const currentLine = lines.find((l) => l.id === currentLineId)
    if (!currentLine) return
    const targetIds = lines
      .filter((l) => l.category_id === currentLine.category_id)
      .filter((l) => !CATS_HUMAINS.includes(l.regime))
      .filter((l) => l.id === currentLineId || !l.fournisseur_id)
      .map((l) => l.id)
    setLines((p) => p.map((l) => (targetIds.includes(l.id) ? { ...l, fournisseur_id: fId } : l)))
    const { error } = await supabase
      .from('devis_lines')
      .update({ fournisseur_id: fId })
      .in('id', targetIds)
    if (error) {
      console.error('[Fournisseur] bulk assign:', error)
      load()
    }
  }

  async function selectFournisseur(lineId, fournisseurId, nomNouveau) {
    if (!canEdit) return
    let fId = fournisseurId
    if (!fId && nomNouveau) {
      const { data, error } = await supabase
        .from('fournisseurs')
        .insert({ nom: nomNouveau, org_id: project.org_id })
        .select()
        .single()
      if (error) {
        console.error('[Fournisseur] create:', error)
        return
      }
      setFournisseurs((p) => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom)))
      fId = data.id
    }
    setLines((p) => p.map((l) => (l.id === lineId ? { ...l, fournisseur_id: fId } : l)))
    const { error } = await supabase
      .from('devis_lines')
      .update({ fournisseur_id: fId })
      .eq('id', lineId)
    if (error) {
      console.error('[Fournisseur] assign:', error)
      setLines((p) => p.map((l) => (l.id === lineId ? { ...l, fournisseur_id: null } : l)))
    }
  }

  // ── KPIs : fonction paramétrable (projet entier OU lot spécifique) ─────
  // Passer un scope { lotId } filtre lines/additifs pour ce lot uniquement.
  // Passer null retourne les KPIs globaux (toutes lignes, tous additifs).
  function computeKpis(scope) {
    const scopedLines = scope?.lotId
      ? (linesByLot[scope.lotId] || [])
      : lines
    const scopedAdditifs = scope?.lotId
      ? (additifsByLot[scope.lotId] || [])
      : reel.filter((r) => r.is_additif)
    const scopedRefDevis = scope?.lotId
      ? refDevisByLot[scope.lotId]
      : null // résolu plus bas pour le mode global

    let coutPrevu = 0
    let coutReelConfirme = 0
    let coutReelProjete = 0
    let nbLignes = 0
    let nbLignesSaisies = 0
    let resteRegler = 0
    let tvaRecuperable = 0

    for (const line of scopedLines) {
      const cp = refCout(line, membreByLine[line.id])
      coutPrevu += cp
      nbLignes += 1
      const e = reelByLine[line.id]
      const isSaisie = Boolean(e) && e.montant_ht != null
      if (isSaisie) {
        nbLignesSaisies += 1
        coutReelConfirme += e.montant_ht
        coutReelProjete += e.montant_ht
        if (!e.paye && e.montant_ht > 0) resteRegler += e.montant_ht
        tvaRecuperable += ((e.montant_ht || 0) * (Number(e.tva_rate) || 0)) / 100
      } else {
        coutReelProjete += cp
      }
    }
    for (const a of scopedAdditifs) {
      coutReelConfirme += a.montant_ht || 0
      coutReelProjete += a.montant_ht || 0
      if (!a.paye) resteRegler += a.montant_ht || 0
      tvaRecuperable += ((a.montant_ht || 0) * (Number(a.tva_rate) || 0)) / 100
    }

    // Vente HT :
    // - Mode lot : via refDevisByLot + cats/lines de ce lot.
    // - Mode global : somme des ventes de chaque lot (additive).
    let venteHT = 0
    let tvaRate = 20
    let acomptePct = 30
    let globalAdj = {
      marge_globale_pct: 0,
      assurance_pct: 0,
      remise_globale_pct: 0,
      remise_globale_montant: 0,
    }

    if (scopedRefDevis) {
      // Lot : calcul direct sur refDevis de ce lot
      const lotCats = catsByLot[scope.lotId] || []
      const catDansMarge = {}
      for (const c of lotCats) catDansMarge[c.id] = c.dans_marge !== false
      const synthLines = scopedLines
        .filter((l) => l.use_line)
        .map((l) => ({
          ...l,
          dans_marge: catDansMarge[l.category_id] !== false,
        }))
      globalAdj = {
        marge_globale_pct: Number(scopedRefDevis.marge_globale_pct) || 0,
        assurance_pct: Number(scopedRefDevis.assurance_pct) || 0,
        remise_globale_pct: Number(scopedRefDevis.remise_globale_pct) || 0,
        remise_globale_montant: Number(scopedRefDevis.remise_globale_montant) || 0,
      }
      tvaRate = Number(scopedRefDevis.tva_rate) || 20
      acomptePct = Number(scopedRefDevis.acompte_pct) || 30
      const synth = calcSynthese(synthLines, tvaRate, acomptePct, TAUX_DEFAUT, globalAdj)
      venteHT = synth.totalHTFinal
    } else {
      // Global : additionne les ventes HT de chaque lot
      for (const lot of lotsWithRef) {
        const rd = refDevisByLot[lot.id]
        const lotCats = catsByLot[lot.id] || []
        const lotLines = linesByLot[lot.id] || []
        const catDansMarge = {}
        for (const c of lotCats) catDansMarge[c.id] = c.dans_marge !== false
        const synthLines = lotLines
          .filter((l) => l.use_line)
          .map((l) => ({
            ...l,
            dans_marge: catDansMarge[l.category_id] !== false,
          }))
        const adj = {
          marge_globale_pct: Number(rd.marge_globale_pct) || 0,
          assurance_pct: Number(rd.assurance_pct) || 0,
          remise_globale_pct: Number(rd.remise_globale_pct) || 0,
          remise_globale_montant: Number(rd.remise_globale_montant) || 0,
        }
        const synth = calcSynthese(
          synthLines,
          Number(rd.tva_rate) || 20,
          Number(rd.acompte_pct) || 30,
          TAUX_DEFAUT,
          adj,
        )
        venteHT += synth.totalHTFinal
      }
      // TVA : on applique le taux du premier refDevis (tous les lots devraient partager le même taux en pratique)
      tvaRate = Number(refDevisByLot[lotsWithRef[0]?.id]?.tva_rate) || 20
    }

    const tvaCollectee = (venteHT * tvaRate) / 100
    const tvaAReverser = Math.max(0, tvaCollectee - tvaRecuperable)
    const ecartCout = coutReelProjete - coutPrevu
    const margePrevue = venteHT - coutPrevu
    const margeReelle = venteHT - coutReelProjete
    const deltaMarge = margeReelle - margePrevue
    const avancement = coutPrevu > 0 ? (coutReelConfirme / coutPrevu) * 100 : 0
    const resteAEngager = Math.max(0, coutPrevu - coutReelConfirme)

    return {
      venteHT,
      coutPrevu,
      coutReelConfirme,
      coutReelProjete,
      margePrevue,
      margeReelle,
      deltaMarge,
      ecartCout,
      avancement,
      resteAEngager,
      resteRegler,
      nbLignes,
      nbLignesSaisies,
      tvaCollectee,
      tvaRecuperable,
      tvaAReverser,
    }
  }

  // KPIs globaux (projet entier) — on les garde toujours sous la main pour d'autres usages
  const globalKpis = useMemo(
    () => computeKpis(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, reel, reelByLine, membreByLine, lotsWithRef, refDevisByLot, catsByLot, linesByLot, additifsByLot],
  )

  // KPIs affichés dans la barre principale — dépendent du scope choisi par l'utilisateur
  const displayedKpis = useMemo(
    () => (kpiScope === '__all__' ? globalKpis : computeKpis({ lotId: kpiScope })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kpiScope, globalKpis, lines, reel, reelByLine, membreByLine, lotsWithRef, refDevisByLot, catsByLot, linesByLot, additifsByLot],
  )

  // refDevis pour le header de la KpiBar :
  // - scope lot : on prend le refDevis de ce lot (on voit "Devis V{n}" exact)
  // - scope agrégé : on prend celui du premier lot (indicatif, on sait qu'on somme)
  const displayedHeaderRefDevis = useMemo(() => {
    if (kpiScope !== '__all__') {
      const rd = refDevisByLot[kpiScope]
      if (rd) return rd
    }
    const firstRef = lotsWithRef[0] ? refDevisByLot[lotsWithRef[0].id] : null
    if (firstRef) return firstRef
    return { version_number: '?', status: '' }
  }, [kpiScope, lotsWithRef, refDevisByLot])

  // ── Scope : lots visibles + données RecapPaiements filtrées ───────────────
  // En mode agrégé, on garde strictement le comportement actuel.
  // En mode lot, on ne rend que ce lot, et on filtre lines/reel en amont
  // de RecapPaiements pour qu'il ne groupe que les lignes & additifs du lot.
  const visibleLots = useMemo(
    () => (kpiScope === '__all__' ? lotsWithRef : lotsWithRef.filter((l) => l.id === kpiScope)),
    [kpiScope, lotsWithRef],
  )
  const recapData = useMemo(() => {
    if (kpiScope === '__all__') return { lines, reel }
    const scopedLineIds = new Set((linesByLot[kpiScope] || []).map((l) => l.id))
    return {
      lines: lines.filter((l) => scopedLineIds.has(l.id)),
      reel: reel.filter((r) => {
        if (r.is_additif) return r.lot_id === kpiScope
        return scopedLineIds.has(r.line_id)
      }),
    }
  }, [kpiScope, lines, reel, linesByLot])

  // ── Compteurs filtres (globaux) ───────────────────────────────────────────
  const filterCounts = useMemo(() => {
    let estimees = 0
    let nonPayees = 0
    let ecart = 0
    for (const line of lines) {
      const e = reelByLine[line.id]
      const cp = refCout(line, membreByLine[line.id])
      const isEstimee = !e || e.montant_ht == null
      if (isEstimee) {
        estimees += 1
        continue
      }
      if (!e.paye) nonPayees += 1
      if (cp > 0) {
        const ratio = Math.abs(e.montant_ht - cp) / cp
        if (ratio > 0.1) ecart += 1
      }
    }
    const additifs = reel.filter((r) => r.is_additif).length
    return { estimees, nonPayees, ecart, additifs }
  }, [lines, reel, reelByLine, membreByLine])

  // ── Render ────────────────────────────────────────────────────────────────

  // BUDGET-PERM — attente de la résolution des permissions projet
  if (permLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div
          className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  // BUDGET-PERM — prestataire sans droit 'budget' : refus explicite
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Accès refusé — vous n&apos;avez pas accès au suivi budgétaire de ce projet.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div
          className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  if (lotsWithRef.length === 0) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Aucun devis de référence disponible sur ce projet.
          <br />
          Sélectionne un devis « envoyé » ou « accepté » dans l&apos;onglet Devis pour activer le suivi budget.
        </p>
      </div>
    )
  }

  // Handlers factorisés (évite de repasser 15 props à chaque section)
  const handlers = {
    saveLineReel,
    clearLineReel,
    confirmLineAtPrevu,
    confirmBlocAtPrevu,
    selectFournisseur,
    applyFournisseurToBloc,
    addAdditif,
    updateAdditif,
    deleteAdditif,
    toggleBlocCollapsed,
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* ── Notice lecture seule (BUDGET-PERM) ─────────────────────────── */}
      {!canEdit && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            background: 'var(--bg-elev)',
            color: 'var(--txt-3)',
            border: '1px solid var(--brd-sub)',
          }}
        >
          Vous avez accès en lecture seule — demandez un accès édition pour saisir le budget réel.
        </div>
      )}

      {/* ── Sélecteur de scope (masqué en mono-lot) ─────────────────────── */}
      {isMultiLot && (
        <LotScopeSelector
          lotsWithRef={lotsWithRef}
          scope={kpiScope}
          onChange={setKpiScope}
          lotColor={lotColor}
        />
      )}

      {/* ── KpiBar — réactive au scope (agrégé par défaut) ────────────── */}
      <KpiBar global={displayedKpis} refDevis={displayedHeaderRefDevis} />

      {/* ── Filtres rapides ─────────────────────────────────────────────── */}
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
          // En multi-lot, on plie aussi les lots
          if (isMultiLot) {
            const nextLots = {}
            for (const lot of lotsWithRef) nextLots[lot.id] = true
            setLotCollapsed(nextLots)
          }
        }}
        onExpandAll={() => {
          setBlocCollapsed({})
          setLotCollapsed({})
        }}
        anyCollapsed={
          Object.values(blocCollapsed).some(Boolean) ||
          Object.values(lotCollapsed).some(Boolean)
        }
      />

      {/* ── Sections par lot (filtrées selon le scope) ──────────────────── */}
      {visibleLots.map((lot) => (
        <LotBlocsSection
          key={lot.id}
          lot={lot}
          orderedLots={lotsWithRef}
          refDevis={refDevisByLot[lot.id]}
          cats={catsByLot[lot.id] || []}
          lines={linesByLot[lot.id] || []}
          additifs={additifsByLot[lot.id] || []}
          reelByLine={reelByLine}
          membreByLine={membreByLine}
          fournisseurs={fournisseurs}
          anyFilter={anyFilter}
          lineMatchesFilters={lineMatchesFilters}
          additifMatchesFilters={additifMatchesFilters}
          blocCollapsed={blocCollapsed}
          blocTermine={blocTermine}
          setBlocTermine={setBlocTermine}
          isMultiLot={isMultiLot}
          isCollapsed={isMultiLot ? Boolean(lotCollapsed[lot.id]) : false}
          onToggleCollapse={() => toggleLotCollapsed(lot.id)}
          lotKpis={computeKpis({ lotId: lot.id })}
          handlers={handlers}
        />
      ))}

      {/* ── Additifs orphelins (legacy, lot_id IS NULL) — masqués en scope lot ── */}
      {kpiScope === '__all__' && orphanAdditifs.length > 0 && (
        <OrphanAdditifsSection
          additifs={orphanAdditifs.filter(additifMatchesFilters)}
          totalOrphans={orphanAdditifs.length}
          updateAdditif={updateAdditif}
          deleteAdditif={deleteAdditif}
        />
      )}

      {/* ── Récap Paiements (groupé par personne × lot / fournisseur × lot) — scope ── */}
      <RecapPaiements
        lines={recapData.lines}
        membres={membres}
        reel={recapData.reel}
        reelByLine={reelByLine}
        membreByLine={membreByLine}
        fournisseurs={fournisseurs}
        lotIdByDevisId={lotIdByDevisId}
        lotInfoMap={lotInfoMap}
        isMultiLot={isMultiLot}
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
// SOUS-COMPOSANT : Section d'un lot (accordéon + blocs + additifs du lot)
// ══════════════════════════════════════════════════════════════════════════════
function LotBlocsSection({
  lot,
  orderedLots,
  refDevis,
  cats,
  lines,
  additifs,
  reelByLine,
  membreByLine,
  fournisseurs,
  anyFilter,
  lineMatchesFilters,
  additifMatchesFilters,
  blocCollapsed,
  blocTermine,
  setBlocTermine,
  isMultiLot,
  isCollapsed,
  onToggleCollapse,
  lotKpis,
  handlers,
}) {
  const color = lotColor(lot.id, orderedLots)

  // Regroupe additifs par catégorie (via bloc_name) — les additifs sont rattachés
  // à une cat par leur bloc_name, pas par category_id
  function additifsForCat(cat) {
    return additifs.filter((a) => a.bloc_name === cat?.name)
  }
  function linesForCat(catId) {
    return lines.filter((l) => l.category_id === catId)
  }

  // Contenu des blocs (code migré de la version mono-lot, inchangé fonctionnellement)
  const blocsContent = (
    <>
      {cats.map((cat) => {
        const allCatLines = linesForCat(cat.id)
        const allCatAdditifs = additifsForCat(cat)
        if (allCatLines.length === 0 && allCatAdditifs.length === 0) return null
        const catLines = allCatLines.filter(lineMatchesFilters)
        const catAdditifs = allCatAdditifs.filter(additifMatchesFilters)
        if (anyFilter && catLines.length === 0 && catAdditifs.length === 0) return null

        const blocInfo = getBlocInfo(cat.name)
        const isTermine = Boolean(blocTermine[cat.id])
        const isBlocCollapsed = Boolean(blocCollapsed[cat.id])

        let venteBloc = 0
        let prevuBloc = 0
        let reelBloc = 0
        let resteBloc = 0
        for (const line of allCatLines) {
          const calc = calcLine(line)
          const cp = refCout(line, membreByLine[line.id])
          venteBloc += calc.prixVenteHT + calc.chargesFacturees
          prevuBloc += cp
          const e = reelByLine[line.id]
          const lineReel = e?.montant_ht != null ? e.montant_ht : cp
          reelBloc += lineReel
          if (!e?.paye && lineReel > 0) resteBloc += lineReel
        }
        for (const a of allCatAdditifs) {
          reelBloc += a.montant_ht || 0
          if (!a.paye) resteBloc += a.montant_ht || 0
        }
        const beneficePrevis = venteBloc - prevuBloc
        const beneficeReel = venteBloc - reelBloc
        const nbEstimes = allCatLines.filter((l) => {
          const e = reelByLine[l.id]
          return !e || e.montant_ht == null
        }).length
        const nbMasquees =
          allCatLines.length - catLines.length + (allCatAdditifs.length - catAdditifs.length)

        return (
          <div
            key={cat.id}
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}
          >
            {/* En-tête bloc (cliquable pour replier/déplier) */}
            <div
              className="flex items-center gap-3 px-4 py-2.5"
              onClick={() => handlers.toggleBlocCollapsed(cat.id)}
              style={{
                background: 'var(--bg-elev)',
                borderBottom: isBlocCollapsed ? 'none' : '1px solid var(--brd-sub)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {isBlocCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
              )}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: blocInfo.color }}
              />
              <span
                className="text-[11px] font-bold uppercase tracking-widest flex-1"
                style={{ color: blocInfo.color }}
              >
                {blocInfo.label}
                {isBlocCollapsed && (
                  <span
                    className="ml-2 normal-case tracking-normal"
                    style={{ color: 'var(--txt-3)', fontWeight: 500, fontSize: 10 }}
                  >
                    · {allCatLines.length + allCatAdditifs.length} ligne
                    {allCatLines.length + allCatAdditifs.length > 1 ? 's' : ''}
                  </span>
                )}
              </span>
              {nbEstimes >= 2 && (
                <button
                  onClick={(ev) => {
                    ev.stopPropagation()
                    if (
                      confirm(
                        `Confirmer ${nbEstimes} ligne${nbEstimes > 1 ? 's' : ''} au coût prévu ?`,
                      )
                    )
                      handlers.confirmBlocAtPrevu(cat.id)
                  }}
                  className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
                  style={{
                    background: 'rgba(255,174,0,.12)',
                    color: 'var(--amber)',
                    border: '1px solid rgba(255,174,0,.35)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,174,0,.22)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,174,0,.12)')}
                  title="Créer une entrée budget réel au coût prévu pour les lignes non saisies"
                >
                  <Check className="w-2.5 h-2.5" />
                  Confirmer les {nbEstimes} restantes
                </button>
              )}
              <button
                onClick={(ev) => {
                  ev.stopPropagation()
                  setBlocTermine((p) => ({ ...p, [cat.id]: !isTermine }))
                }}
                className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
                style={{
                  background: isTermine ? 'rgba(0,200,117,.15)' : 'transparent',
                  color: isTermine ? 'var(--green)' : 'var(--txt-3)',
                  border: `1px solid ${isTermine ? 'rgba(0,200,117,.3)' : 'var(--brd)'}`,
                }}
              >
                {isTermine && <Check className="w-2.5 h-2.5" />}
                TERMINÉ
              </button>
            </div>

            {!isBlocCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                      <Th left style={{ minWidth: 150 }}>
                        Produit
                      </Th>
                      <Th left style={{ minWidth: 110 }}>
                        Prestataire
                      </Th>
                      <Th right style={{ minWidth: 90 }}>
                        Vendu HT
                      </Th>
                      <Th right style={{ minWidth: 170 }}>
                        Coût prévu → réel
                      </Th>
                      <Th center style={{ width: 56 }}>
                        Statut
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const blocFournLines = allCatLines.filter(
                        (l) => !CATS_HUMAINS.includes(l.regime),
                      )
                      const emptyInBloc = blocFournLines.filter((l) => !l.fournisseur_id).length
                      return catLines.map((line, idx) => {
                        const calc = calcLine(line)
                        const memb = membreByLine[line.id]
                        const entry = reelByLine[line.id]
                        const cp = refCout(line, memb)
                        const hasConvenu = memb?.budget_convenu != null
                        const ecart = entry?.montant_ht != null ? entry.montant_ht - cp : null
                        const venduHT = calc.prixVenteHT + calc.chargesFacturees
                        const isHuman = CATS_HUMAINS.includes(line.regime)
                        const otherEmptyInBloc = isHuman
                          ? 0
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
                            onSave={(fields) => handlers.saveLineReel(line.id, fields)}
                            onClear={() => handlers.clearLineReel(line.id)}
                            onConfirmAtPrevu={() => handlers.confirmLineAtPrevu(line.id)}
                            onSelectFournisseur={(fId, nom) =>
                              handlers.selectFournisseur(line.id, fId, nom)
                            }
                            onApplyFournisseurToBloc={(fId, nom) =>
                              handlers.applyFournisseurToBloc(line.id, fId, nom)
                            }
                          />
                        )
                      })
                    })()}

                    {catAdditifs.length > 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 pt-3 pb-1">
                          <span
                            className="text-[10px] font-bold uppercase tracking-widest"
                            style={{ color: 'var(--txt-3)' }}
                          >
                            Additifs
                          </span>
                        </td>
                      </tr>
                    )}
                    {catAdditifs.map((a, idx) => (
                      <AdditifRow
                        key={a.id}
                        entry={a}
                        odd={idx % 2 === 1}
                        onChange={(f) => handlers.updateAdditif(a.id, f)}
                        onDelete={() => handlers.deleteAdditif(a.id)}
                      />
                    ))}

                    {nbMasquees > 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-1.5 text-center text-[10px] italic"
                          style={{ color: 'var(--txt-3)', background: 'rgba(0,122,255,.04)' }}
                        >
                          {nbMasquees} ligne{nbMasquees > 1 ? 's' : ''} masquée
                          {nbMasquees > 1 ? 's' : ''} par les filtres actifs
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td colSpan={5} className="px-4 py-2">
                        <button
                          onClick={() => handlers.addAdditif(cat.id)}
                          className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg transition-all"
                          style={{ color: 'var(--txt-3)', border: '1px dashed var(--brd)' }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = 'var(--blue)'
                            e.currentTarget.style.borderColor = 'rgba(0,122,255,.4)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = 'var(--txt-3)'
                            e.currentTarget.style.borderColor = 'var(--brd)'
                          }}
                        >
                          <Plus className="w-3 h-3" /> Additif hors-devis
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

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
    </>
  )

  // Mono-lot : pas d'accordéon, on renvoie directement les blocs en flux
  if (!isMultiLot) {
    return <div className="space-y-5">{blocsContent}</div>
  }

  // Multi-lot : accordéon avec header coloré + mini-KPI lot
  const margeColor =
    lotKpis.margeReelle < 0
      ? 'var(--red)'
      : lotKpis.deltaMarge < -0.01
        ? 'var(--amber)'
        : 'var(--green)'
  const ecartColor =
    lotKpis.ecartCout > 0.01
      ? 'var(--red)'
      : lotKpis.ecartCout < -0.01
        ? 'var(--green)'
        : 'var(--txt-3)'

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}
    >
      {/* Header accordéon lot */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        onClick={onToggleCollapse}
        style={{
          background: 'var(--bg-elev)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--brd-sub)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        )}
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: color }}
        />
        <Package className="w-3.5 h-3.5 shrink-0" style={{ color }} />
        <div className="flex-1 min-w-0">
          <p
            className="text-[12px] font-bold tracking-wide truncate"
            style={{ color: 'var(--txt)' }}
          >
            {lot.title}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
            Devis V{refDevis.version_number}
            {refDevis.status === 'accepte' ? ' · accepté' : ''}
            {' · '}
            {lotKpis.nbLignes} ligne{lotKpis.nbLignes > 1 ? 's' : ''}
            {' · '}
            {lotKpis.nbLignesSaisies}/{lotKpis.nbLignes} saisies
          </p>
        </div>
        {/* Mini-KPI : vente · prévu→réel · marge */}
        <div className="flex items-center gap-5 shrink-0" style={{ fontSize: 11 }}>
          <KpiChip label="Vente HT" value={fmtEur(lotKpis.venteHT)} color="var(--blue)" />
          <KpiChip
            label="Prévu → Réel"
            value={
              <span>
                <span style={{ color: 'var(--amber)' }}>{fmtEur(lotKpis.coutPrevu)}</span>
                <span style={{ color: 'var(--txt-3)' }}> → </span>
                <span style={{ color: ecartColor, fontWeight: 700 }}>
                  {fmtEur(lotKpis.coutReelProjete)}
                </span>
              </span>
            }
          />
          <KpiChip
            label="Marge"
            value={fmtEur(lotKpis.margeReelle)}
            color={margeColor}
          />
        </div>
      </div>

      {/* Contenu accordéon */}
      {!isCollapsed && <div className="p-4 space-y-4">{blocsContent}</div>}
    </div>
  )
}

// Chip compact pour les mini-KPI dans le header lot
function KpiChip({ label, value, color }) {
  return (
    <div className="flex flex-col items-end">
      <span
        className="text-[9px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--txt-3)' }}
      >
        {label}
      </span>
      <span className="tabular-nums font-semibold" style={{ color: color || 'var(--txt)' }}>
        {value}
      </span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SOUS-COMPOSANT : Additifs orphelins (legacy, lot_id IS NULL)
// ══════════════════════════════════════════════════════════════════════════════
function OrphanAdditifsSection({ additifs, totalOrphans, updateAdditif, deleteAdditif }) {
  const [collapsed, setCollapsed] = useState(false)
  if (totalOrphans === 0) return null
  // Regroupés par bloc_name pour garder un minimum de structure
  const byBloc = {}
  for (const a of additifs) {
    const key = a.bloc_name || '—'
    if (!byBloc[key]) byBloc[key] = []
    byBloc[key].push(a)
  }
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px dashed var(--brd)', background: 'var(--bg-surf)' }}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          background: 'var(--bg-elev)',
          borderBottom: collapsed ? 'none' : '1px solid var(--brd-sub)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
        )}
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--txt-3)' }} />
        <span
          className="text-[11px] font-bold uppercase tracking-widest flex-1"
          style={{ color: 'var(--txt-3)' }}
        >
          Hors lot · additifs non rattachés
          <span
            className="ml-2 normal-case tracking-normal"
            style={{ color: 'var(--txt-3)', fontWeight: 500, fontSize: 10 }}
          >
            · {totalOrphans} additif{totalOrphans > 1 ? 's' : ''}
          </span>
        </span>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                <Th left style={{ minWidth: 150 }}>
                  Produit
                </Th>
                <Th left style={{ minWidth: 110 }}>
                  Prestataire
                </Th>
                <Th right style={{ minWidth: 90 }}>
                  Vendu HT
                </Th>
                <Th right style={{ minWidth: 170 }}>
                  Coût réel
                </Th>
                <Th center style={{ width: 56 }}>
                  Statut
                </Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byBloc).map(([blocName, arr]) => (
                <Fragment key={blocName}>
                  <tr>
                    <td colSpan={5} className="px-4 pt-3 pb-1">
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        {blocName}
                      </span>
                    </td>
                  </tr>
                  {arr.map((a, idx) => (
                    <AdditifRow
                      key={a.id}
                      entry={a}
                      odd={idx % 2 === 1}
                      onChange={(f) => updateAdditif(a.id, f)}
                      onDelete={() => deleteAdditif(a.id)}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

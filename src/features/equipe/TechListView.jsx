// ════════════════════════════════════════════════════════════════════════════
// TechListView — Vue principale de la tech list d'un projet (P1.5)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche les attributions du projet (1 ligne = 1 row projet_membres
// principale, parent_membre_id IS NULL). Les rows rattachées sont masquées
// ici (visibles dans Attribution + dans le détail d'une persona).
//
// Structure :
//   1. Boîte "📥 À trier" (toujours en haut, stylée distinctement) qui
//      contient les rows avec category IS NULL.
//   2. Sections par catégorie (PRODUCTION, EQUIPE TECHNIQUE, POST PRODUCTION
//      + custom utilisées). Une section vide affiche un message "Glisser une
//      ligne ici".
//
// Drag & drop : HTML5 native. On drag d'une ligne, on lâche dans une
// catégorie → met à jour la row.category (per-row, choix Y validé). Une
// ligne peut aussi être lâchée dans la boîte "À trier" pour la décatégoriser.
//
// Toggle coordonnées sensibles : neutre par défaut (off), bleu quand actif.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Users, Plus, Eye, EyeOff, Loader2, Inbox,
  Share2, FileText, ChevronDown, FileSpreadsheet, Edit2,
  Trash2, GripVertical,
} from 'lucide-react'
import { useCrew } from '../../hooks/useCrew'
import { useAuth } from '../../contexts/AuthContext'
import { extractPeriodes, expandDays, hasAnyRange } from '../../lib/projectPeriodes'
import { fullNameFromPersona, personaKey } from '../../lib/crew'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import { supabase } from '../../lib/supabase'
import AttributionRow from './components/AttributionRow'
import EquipePreviewModal from './components/EquipePreviewModal'
import AddMemberModal from './components/AddMemberModal'
import PresenceCalendarModal from './components/PresenceCalendarModal'
import AttachModal from './components/AttachModal'
import TechlistShareModal from './components/TechlistShareModal'
import MembreDrawer from './components/MembreDrawer'
import PdfPreviewModal from '../materiel/components/PdfPreviewModal'
import { buildTechlistPdf } from './equipeTechlistPdfExport'

const SENTINEL_UNCATEGORIZED = '__uncategorized__'

export default function TechListView({
  project,
  projectId,
  canEdit = true,
  // P3 — filtre par lot (partagé avec Attribution + Finances)
  selectedLotId = null,    // string | null (null = "Tous")
  lineLotMap = {},         // { [devis_line_id]: lotId }
  lotInfoMap = {},         // { [lotId]: { title, color } }
  isMultiLot = false,      // true si lotsWithRef.length > 1
  // P4 — pour l'export PDF + partage : la liste des lots ordonnée (pour
  // proposer "PDF — LotA / LotB / ..." dans le dropdown d'export). Source
  // de vérité = lotsWithRef de EquipeTab (= les lots avec devis de réf).
  lotsWithRef = [],
  // EQUIPE-RT-PRESENCE — soft lock collaboratif (passé depuis EquipeTab)
  // othersEditingByRow : Map<rowId, {user_id, full_name}>
  // setMyEditingRowId : (rowId | null) => void — broadcast mon focus
  othersEditingByRow = null,
  setMyEditingRowId = null,
}) {
  const { org } = useAuth()
  const {
    members,
    contacts,
    techlistRows,
    uncategorized,
    byCategory,
    categories,
    loading,
    error,
    reload,
    addMember,
    addContact,
    updateMember,
    updatePersona,
    reorderCategory,
    renameCategory,
    removeMember,
    attachMember,
    detachMember,
  } = useCrew(projectId)

  const [showSensitive, setShowSensitive] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [presenceFor, setPresenceFor] = useState(null)
  const [attachFor, setAttachFor] = useState(null)
  // P4.3 — Drawer "Vue par membre" : on stocke le personaKey de la
  // persona ouverte (string), null = drawer fermé.
  const [membreDrawerKey, setMembreDrawerKey] = useState(null)
  // P4-PREVIEW — Mode vue seule (modal plein écran, style page share).
  const [previewOpen, setPreviewOpen] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverCat, setDragOverCat] = useState(null)
  // P1.10 : drop sur une row précise (au-dessus = before / dessous = after)
  const [dragOverRow, setDragOverRow] = useState(null) // { id, position }
  // P4.1 : dropdown d'export (PDF / partage)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPos, setExportPos] = useState({})
  const [exporting, setExporting] = useState(false)
  const exportTriggerRef = useRef(null)
  // P4.1 : preview state pour PdfPreviewModal — { open, title, url, filename,
  // download, revoke }. Pattern aligné sur MaterielTab + LivrablesTab.
  const [previewState, setPreviewState] = useState(null)
  // P4.2 : modale de gestion des liens de partage public
  const [shareOpen, setShareOpen] = useState(false)
  // P4-CATEGORIES : catégories "vides" ajoutées manuellement par l'admin
  // (pas encore de row associée). Persistées en localStorage par projet
  // ET dans projects.metadata.equipe.extra_categories pour synchro entre
  // devices (admin sur desktop + mobile = même vue).
  // localStorage = cache instant render ; metadata DB = source de vérité
  // cross-device (cf. useEffect d'hydratation un peu plus bas).
  const extraCatsKey = `equipe.extraCategories.${projectId || 'noproj'}`
  const [extraCategories, setExtraCategories] = useState(() => {
    try {
      const raw =
        typeof window !== 'undefined' ? window.localStorage.getItem(extraCatsKey) : null
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  // Persiste les extraCategories à chaque changement (localStorage seulement ;
  // la persistance DB se fait dans le useEffect combiné plus bas, debouncé).
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(extraCatsKey, JSON.stringify(extraCategories))
      }
    } catch { /* no-op */ }
  }, [extraCatsKey, extraCategories])
  // Nettoyage : retire des extraCategories celles qui ont au moins une row
  // (= elles sont devenues "réelles" et apparaîtront via listCategories).
  useEffect(() => {
    if (!extraCategories.length) return
    const usedSet = new Set(members.map((m) => m.category).filter(Boolean))
    const stillEmpty = extraCategories.filter((c) => !usedSet.has(c))
    if (stillEmpty.length !== extraCategories.length) {
      setExtraCategories(stillEmpty)
    }
  }, [members, extraCategories])
  // P4-CATEGORIES : catégories explicitement masquées par l'admin (via le
  // bouton Supprimer sur une catégorie vide). Stockées par projet dans
  // localStorage. Si plus tard une row est créée avec ce nom de catégorie,
  // on retire automatiquement de hiddenCategories (cf. useEffect ci-après).
  const hiddenCatsKey = `equipe.hiddenCategories.${projectId || 'noproj'}`
  const [hiddenCategories, setHiddenCategories] = useState(() => {
    try {
      const raw =
        typeof window !== 'undefined' ? window.localStorage.getItem(hiddenCatsKey) : null
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(hiddenCatsKey, JSON.stringify(hiddenCategories))
      }
    } catch { /* no-op */ }
  }, [hiddenCatsKey, hiddenCategories])
  // Si une catégorie cachée se met à contenir des rows (drag d'un membre
  // dedans depuis une autre source), on la dé-cache automatiquement.
  useEffect(() => {
    if (!hiddenCategories.length) return
    const usedSet = new Set(members.map((m) => m.category).filter(Boolean))
    const stillHidden = hiddenCategories.filter((c) => !usedSet.has(c))
    if (stillHidden.length !== hiddenCategories.length) {
      setHiddenCategories(stillHidden)
    }
  }, [members, hiddenCategories])

  // P4-CATEGORIES : ordre custom des catégories (drag & drop des headers).
  // Si une catégorie n'est pas dans la liste, elle est ajoutée à la fin.
  const catOrderKey = `equipe.categoryOrder.${projectId || 'noproj'}`
  const [categoryOrder, setCategoryOrder] = useState(() => {
    try {
      const raw =
        typeof window !== 'undefined' ? window.localStorage.getItem(catOrderKey) : null
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(catOrderKey, JSON.stringify(categoryOrder))
      }
    } catch { /* no-op */ }
  }, [catOrderKey, categoryOrder])


  // P4-CATEGORIES : drag d'un header de catégorie pour réorganiser.
  const [draggingCategory, setDraggingCategory] = useState(null)
  // P4-CATEGORIES : modal d'ajout de catégorie personnalisée (remplace
  // window.prompt natif, peu stylé).
  const [newCatOpen, setNewCatOpen] = useState(false)

  // Liste finale fusionnée + ordre + filtrée des cachées.
  // - Source : categories (DB) + extraCategories (localStorage vides)
  // - Filtre : exclure hiddenCategories sauf si la cat a des rows
  // - Ordre : selon categoryOrder, puis le reste à la fin
  const allCategories = useMemo(() => {
    const set = new Set(categories)
    for (const e of extraCategories) set.add(e)
    const usedSet = new Set(members.map((m) => m.category).filter(Boolean))
    const visible = [...set].filter(
      (c) => !hiddenCategories.includes(c) || usedSet.has(c),
    )
    if (!categoryOrder.length) return visible
    const ordered = []
    const seen = new Set()
    for (const c of categoryOrder) {
      if (visible.includes(c)) {
        ordered.push(c)
        seen.add(c)
      }
    }
    for (const c of visible) {
      if (!seen.has(c)) ordered.push(c)
    }
    return ordered
  }, [categories, extraCategories, hiddenCategories, categoryOrder, members])

  // P4-CATEGORIES : hydratation depuis projects.metadata.equipe au mount.
  // Quand un admin configure ses catégories (extras / hidden / order) sur
  // desktop, on les sauve aussi en DB pour que d'autres devices (mobile,
  // autre browser) en héritent au lieu de retomber sur les defaults.
  //
  // On hydrate UNE FOIS par projet (hydratedFromDbRef). Sans ça, les
  // changements locaux post-mount seraient écrasés par chaque arrivée de
  // données. Si la DB est vide (cas legacy / projet jamais configuré),
  // on garde le state local (init depuis localStorage) MAIS on marque
  // l'hydratation comme done pour DÉBLOQUER la persistance DB qui va
  // alors écrire les valeurs localStorage en base — c'est ce qui permet
  // le 1er sync : un admin desktop avec des données dans son localStorage
  // les pousse en DB dès qu'il ouvre la Crew list, et les autres devices
  // peuvent ensuite hériter.
  //
  // Garde-fou : on attend que le project soit bien défini (project?.id
  // === projectId) avant de marquer hydraté, sinon on pourrait hydrater
  // contre un project encore null et bloquer pour rien.
  const hydratedFromDbRef = useRef(null)
  useEffect(() => {
    if (!projectId) return
    if (hydratedFromDbRef.current === projectId) return
    // Attendre que le project soit chargé pour ce projectId avant de
    // marquer l'hydratation faite.
    if (!project || project.id !== projectId) return
    const meta = project?.metadata?.equipe
    if (meta && typeof meta === 'object') {
      if (Array.isArray(meta.extra_categories)) {
        setExtraCategories(meta.extra_categories)
      }
      if (Array.isArray(meta.hidden_categories)) {
        setHiddenCategories(meta.hidden_categories)
      }
      if (Array.isArray(meta.category_order)) {
        setCategoryOrder(meta.category_order)
      }
    }
    // Toujours marquer comme hydraté, MÊME si la DB est vide — ça
    // débloque la persistance qui écrira les valeurs localStorage en DB
    // (donc les autres devices pourront ensuite les hériter).
    hydratedFromDbRef.current = projectId
  }, [projectId, project])

  // P4-CATEGORIES : persiste les 3 réglages (extra_categories,
  // hidden_categories, category_order) dans projects.metadata.equipe
  // pour synchro cross-device + partage public (/share/equipe/:token,
  // qui n'utilise QUE category_order).
  //
  // On écrit allCategories (ordre RENDU) plutôt que categoryOrder (drag
  // explicite) pour que la metadata soit immédiatement peuplée même si
  // l'admin n'a jamais drag — et reflète exactement le rendu courant.
  //
  // Debouncé 600ms pour éviter les writes en cascade lors d'un drag rapide.
  // Ignore les erreurs (le localStorage reste source de vérité côté admin).
  const lastWrittenMetaRef = useRef(null)
  useEffect(() => {
    if (!projectId || !canEdit) return undefined
    // Ne pas écrire avant d'avoir hydraté depuis la DB (sinon on overwrite
    // la DB avec les valeurs initiales du localStorage avant d'avoir lu).
    if (hydratedFromDbRef.current !== projectId) return undefined
    if (!allCategories || allCategories.length === 0) return undefined
    const payload = {
      extra_categories: extraCategories,
      hidden_categories: hiddenCategories,
      category_order: allCategories,
    }
    const serialized = JSON.stringify(payload)
    if (lastWrittenMetaRef.current === serialized) return undefined
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('metadata')
          .eq('id', projectId)
          .single()
        if (error) throw error
        const currentMeta = data?.metadata || {}
        const currentEquipe = currentMeta.equipe || {}
        // Skip si toutes les valeurs DB sont déjà identiques (évite le
        // write inutile au tout premier mount d'un projet déjà à jour).
        const currentSerialized = JSON.stringify({
          extra_categories: currentEquipe.extra_categories || [],
          hidden_categories: currentEquipe.hidden_categories || [],
          category_order: currentEquipe.category_order || [],
        })
        if (currentSerialized === serialized) {
          lastWrittenMetaRef.current = serialized
          return
        }
        const nextMeta = {
          ...currentMeta,
          equipe: {
            ...currentEquipe,
            ...payload,
          },
        }
        const { error: updErr } = await supabase
          .from('projects')
          .update({ metadata: nextMeta })
          .eq('id', projectId)
        if (updErr) throw updErr
        lastWrittenMetaRef.current = serialized
      } catch (err) {
        console.warn(
          '[TechListView] persist categories metadata DB failed:',
          err?.message || err,
        )
      }
    }, 600)
    return () => clearTimeout(t)
  }, [projectId, canEdit, allCategories, extraCategories, hiddenCategories])

  // P4-DRAWER : édition d'un contact annuaire depuis le drawer.
  // Met à jour la table `contacts` directement (source de vérité partagée
  // par tous les projets de l'org), puis appelle reload() pour rafraîchir
  // le join contacts côté useCrew (la subscription Realtime est sur
  // projet_membres, pas sur contacts → reload manuel nécessaire).
  // Conversion "" → null pour les champs typés Postgres (idem Contacts.jsx).
  const updateContact = async (contactId, fields) => {
    if (!contactId || !fields) return
    const NULLABLE_FIELDS = [
      'date_naissance', 'email', 'telephone', 'address', 'code_postal',
      'ville', 'pays', 'specialite', 'regime', 'regime_alimentaire',
      'taille_tshirt', 'permis', 'siret', 'tva_intracommunautaire',
      'iban', 'bic', 'numero_secu', 'notes', 'user_id',
    ]
    const payload = { ...fields }
    for (const k of NULLABLE_FIELDS) {
      if (k in payload && (payload[k] === '' || payload[k] === undefined)) {
        payload[k] = null
      }
    }
    try {
      const { error } = await supabase
        .from('contacts')
        .update(payload)
        .eq('id', contactId)
      if (error) throw error
      notify.success('Fiche annuaire mise à jour')
      // Reload pour rafraîchir le join contacts dans members
      await reload()
    } catch (err) {
      notify.error('Erreur : ' + (err.message || JSON.stringify(err)))
    }
  }

  // Helpers exposés à CategorySection
  const handleDeleteCategory = (cat) => {
    // Sécurité : on ne supprime que si la cat est vide (vérifié aussi
    // côté UI via count === 0)
    const hasRows = members.some((m) => m.category === cat)
    if (hasRows) return
    if (extraCategories.includes(cat)) {
      setExtraCategories((prev) => prev.filter((c) => c !== cat))
    } else {
      setHiddenCategories((prev) =>
        prev.includes(cat) ? prev : [...prev, cat],
      )
    }
  }
  const handleReorderCategories = (sourceCat, targetCat, position) => {
    if (!sourceCat || sourceCat === targetCat) return
    const list = [...allCategories]
    const fromIdx = list.indexOf(sourceCat)
    const toIdx = list.indexOf(targetCat)
    if (fromIdx === -1 || toIdx === -1) return
    list.splice(fromIdx, 1)
    const insertAt =
      position === 'before'
        ? list.indexOf(targetCat)
        : list.indexOf(targetCat) + 1
    list.splice(insertAt, 0, sourceCat)
    setCategoryOrder(list)
  }
  const closePreview = () => {
    setPreviewState((prev) => {
      if (prev?.revoke) {
        try { prev.revoke() } catch { /* no-op */ }
      }
      return null
    })
  }

  // Périodes du projet pour borner le calendrier de présence
  const periodes = extractPeriodes(project?.metadata)
  const tournageDays = hasAnyRange(periodes.tournage)
    ? expandDays(periodes.tournage)
    : []
  const tournageAnchor =
    tournageDays.length > 0
      ? (() => {
          const [y, m, d] = tournageDays[0].split('-').map(Number)
          return new Date(y, m - 1, d)
        })()
      : null

  // ─── Handlers drag & drop ──────────────────────────────────────────────
  // On drag d'une row, on lâche sur une catégorie → on update sa `category`.
  // category null/SENTINEL_UNCATEGORIZED = drop dans "À trier".

  const handleDropOnCategory = async (categoryName) => {
    setDragOverCat(null)
    setDragOverRow(null)
    const id = draggingId
    setDraggingId(null)
    if (!id) return
    const row = members.find((m) => m.id === id)
    if (!row) return
    const targetCat = categoryName === SENTINEL_UNCATEGORIZED ? null : categoryName
    if ((row.category || null) === targetCat) return // pas de changement
    try {
      await updateMember(id, { category: targetCat })
    } catch (err) {
      console.error('[TechListView] drop error:', err)
    }
  }

  /**
   * Drop sur une row précise → insère avant/après (réordonne ou change
   * de catégorie + place à la position voulue).
   */
  const handleDropOnRow = async (targetRowId, position) => {
    setDragOverCat(null)
    setDragOverRow(null)
    const id = draggingId
    setDraggingId(null)
    if (!id || id === targetRowId) return
    const draggedRow = members.find((m) => m.id === id)
    const targetRow = members.find((m) => m.id === targetRowId)
    if (!draggedRow || !targetRow) return
    const targetCat = targetRow.category || null

    // Construit l'ordre actuel des rows de la catégorie cible (principales
    // uniquement — les rattachées ne sont pas dans la techlist).
    const inCategory = techlistRows.filter((r) => (r.category || null) === targetCat)
    const orderedIds = inCategory
      .map((r) => r.id)
      .filter((rid) => rid !== id) // retire la row dragguée si déjà dans la cat

    const targetIdx = orderedIds.indexOf(targetRowId)
    if (targetIdx === -1) {
      // Cas exceptionnel : la cible n'est plus dans la liste filtrée.
      // Fallback : drop dans la catégorie sans position précise.
      await handleDropOnCategory(targetCat ?? SENTINEL_UNCATEGORIZED)
      return
    }
    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1
    orderedIds.splice(insertIdx, 0, id)

    try {
      // Si on change de catégorie, on passe targetCat ; sinon undefined
      // (= ne pas toucher à la category).
      const changingCategory = (draggedRow.category || null) !== targetCat
      await reorderCategory(orderedIds, changingCategory ? targetCat : undefined)
    } catch (err) {
      console.error('[TechListView] reorder error:', err)
    }
  }

  // ─── P3 — Filtrage par lot (Option A : strict) ─────────────────────────
  // IMPORTANT : ces useMemo doivent être déclarés AVANT les éventuels
  // returns conditionnels (loading / error) pour respecter rules-of-hooks.
  // Les rows ad-hoc (sans devis_line_id) ne sont visibles qu'en mode "Tous".
  // Quand un lot est sélectionné, on garde uniquement les rows dont la
  // ligne de devis appartient à ce lot.
  const rowMatchesLot = useMemo(() => {
    if (!selectedLotId) return () => true
    return (row) => {
      // Priorité 1 : ligne de devis → lot dérivé du devis_id
      if (row.devis_line_id) {
        return lineLotMap[row.devis_line_id] === selectedLotId
      }
      // Priorité 2 : row ad-hoc avec lot_id direct (EQUIPE-P4.4)
      if (row.lot_id) return row.lot_id === selectedLotId
      // Sinon ad-hoc sans lot → masquée quand un filtre lot est actif
      return false
    }
  }, [selectedLotId, lineLotMap])

  const filteredTechlistRows = useMemo(
    () => (selectedLotId ? techlistRows.filter(rowMatchesLot) : techlistRows),
    [techlistRows, selectedLotId, rowMatchesLot],
  )
  const filteredUncategorized = useMemo(
    () => (selectedLotId ? uncategorized.filter(rowMatchesLot) : uncategorized),
    [uncategorized, selectedLotId, rowMatchesLot],
  )
  const filteredByCategory = useMemo(() => {
    if (!selectedLotId) return byCategory
    const out = {}
    for (const cat of Object.keys(byCategory)) {
      out[cat] = (byCategory[cat] || []).filter(rowMatchesLot)
    }
    return out
  }, [byCategory, selectedLotId, rowMatchesLot])

  // Helper : résoudre la pastille de lot pour une row (multi-lot uniquement,
  // et seulement quand on n'est PAS déjà filtré sur ce lot — sinon redondant).
  const lotInfoForRow = useMemo(() => {
    if (!isMultiLot) return () => null
    if (selectedLotId) return () => null // filtre actif → tag inutile
    return (row) => {
      // Priorité 1 : ligne de devis → lot dérivé
      if (row.devis_line_id) {
        const lotId = lineLotMap[row.devis_line_id]
        return lotId ? lotInfoMap[lotId] || null : null
      }
      // Priorité 2 : ad-hoc avec lot_id direct (EQUIPE-P4.4)
      if (row.lot_id) return lotInfoMap[row.lot_id] || null
      return null
    }
  }, [isMultiLot, selectedLotId, lineLotMap, lotInfoMap])

  // P4.1 — Génère un PDF de la techlist avec un scope donné ('all' ou un lotId)
  // et ouvre la preview inline (PdfPreviewModal) pour que l'utilisateur puisse
  // valider visuellement avant de télécharger.
  // On reconstruit les rows à exporter selon le scope, indépendamment du filtre
  // actif à l'écran : cliquer "PDF — Lot X" alors qu'on est sur "Tous" exporte
  // bien le lot X uniquement.
  async function handleExportPdf(scope) {
    if (exporting) return
    setExportOpen(false)
    setExporting(true)
    try {
      // Filtre des rows pour ce scope (devis_line_id → lineLotMap, sinon
      // fallback sur lot_id direct pour les rows ad-hoc — EQUIPE-P4.4).
      const rowsForExport = scope === 'all'
        ? techlistRows
        : techlistRows.filter((r) => {
            if (r.devis_line_id) return lineLotMap[r.devis_line_id] === scope
            return r.lot_id === scope
          })
      // Pré-attache les infos de lot sur chaque row pour le badge inline.
      const lotsForPdf = lotsWithRef.map((l) => ({
        id: l.id,
        title: l.title,
        color: lotInfoMap[l.id]?.color || null,
      }))
      const enrichedRows = rowsForExport.map((r) => {
        const lotId = r.devis_line_id
          ? lineLotMap[r.devis_line_id]
          : r.lot_id || null
        const lot = lotId ? lotInfoMap[lotId] : null
        return lot ? { ...r, _lot: { ...lot } } : r
      })
      // Plage de jours pour la grille Présence du PDF.
      // On prend l'UNION des presence_days de toutes les rows exportées +
      // les jours de tournage du projet, puis on comble les trous pour
      // obtenir une plage contiguë (min → max). Comme ça la grille couvre
      // bien tous les jours de présence (prépa + tournage), pas seulement
      // les jours de tournage.
      const presenceSet = new Set(tournageDays)
      for (const r of enrichedRows) {
        for (const d of r.persona?.presence_days || []) {
          if (typeof d === 'string') presenceSet.add(d)
        }
      }
      const presenceDaysForPdf = (() => {
        if (presenceSet.size === 0) return []
        const sorted = [...presenceSet].sort()
        const parse = (iso) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
          return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
        }
        const fmt = (d) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const start = parse(sorted[0])
        const end = parse(sorted[sorted.length - 1])
        if (!start || !end) return sorted
        const out = []
        for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
          out.push(fmt(new Date(t)))
        }
        return out
      })()

      const pdf = await buildTechlistPdf({
        project,
        org,
        rows: enrichedRows,
        lots: lotsForPdf,
        scope,
        // Plage de jours contiguë pour la grille Présence du PDF.
        presenceDays: presenceDaysForPdf,
        showSensitive: true, // décision Hugo : coordonnées visibles par défaut
        // EQUIPE-P4-CATEGORIES : ordre custom des sections (drag & drop)
        categoryOrder: allCategories,
      })
      // Title affiché dans le header de la preview modal
      const scopedLot = scope !== 'all' ? lotsWithRef.find((l) => l.id === scope) : null
      const title = scope === 'all'
        ? 'Crew list — tous lots'
        : `Crew list — Lot · ${scopedLot?.title || '—'}`
      setPreviewState({
        open: true,
        title,
        url: pdf.url,
        filename: pdf.filename,
        download: pdf.download,
        revoke: pdf.revoke,
        isZip: false,
      })
    } catch (err) {
      console.error('[TechListView] export PDF error:', err)
      notify.error('Export PDF échoué : ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  function openExportMenu() {
    if (!exportTriggerRef.current) return
    const r = exportTriggerRef.current.getBoundingClientRect()
    const DROPDOWN_W = 240
    const PADDING = 8
    const vw = window.innerWidth
    // Choix gauche/droite selon l'espace disponible :
    //   - si on aligne par la droite du trigger, le dropdown s'étend de
    //     `r.right - DROPDOWN_W` à `r.right` → ok si r.right >= DROPDOWN_W
    //   - sinon (trigger trop à gauche, ex : mobile), on aligne par la
    //     gauche du trigger → s'étend de r.left à r.left + DROPDOWN_W
    //   - si même comme ça ça déborde, on clamp dans le viewport.
    const fitsRightAligned = r.right - DROPDOWN_W >= PADDING
    const pos = { top: r.bottom + 4, width: DROPDOWN_W }
    if (fitsRightAligned) {
      pos.right = vw - r.right
    } else {
      // Aligné par la gauche, clampé pour ne pas dépasser à droite
      const desiredLeft = r.left
      const maxLeft = vw - DROPDOWN_W - PADDING
      pos.left = Math.max(PADDING, Math.min(desiredLeft, maxLeft))
    }
    setExportPos(pos)
    setExportOpen(true)
  }

  // Fermer sur clic extérieur
  useEffect(() => {
    if (!exportOpen) return
    function h(e) {
      const portal = document.getElementById('techlist-export-portal')
      if (portal?.contains(e.target) || exportTriggerRef.current?.contains(e.target)) return
      setExportOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [exportOpen])

  // Cleanup : si la preview est encore ouverte au démontage du composant
  // (changement de tab par ex.), on révoque l'URL pour libérer la mémoire.
  useEffect(() => {
    return () => {
      if (previewState?.revoke) {
        try { previewState.revoke() } catch { /* no-op */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Spinner uniquement au chargement INITIAL (pas sur les reloads après une
  // action — sinon le drawer/modals démontent et perdent leur state local
  // type "editing", brouillon non commité, etc.). Une fois qu'on a des
  // données, on garde l'UI montée même pendant un reload background.
  if (loading && members.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-12 text-sm"
        style={{ color: 'var(--txt-3)' }}
      >
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Chargement de l&rsquo;équipe…
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="rounded-md p-4 text-sm"
        style={{
          background: 'var(--red-bg)',
          color: 'var(--red)',
          border: '1px solid var(--red-brd)',
        }}
      >
        Erreur de chargement : {error.message || String(error)}
        <button type="button" onClick={reload} className="ml-3 underline">
          Réessayer
        </button>
      </div>
    )
  }

  // ─── Stats compactes (remplacent les KPI cards en mode techlist) ───────
  // Compte de personnes uniques, validés, en recherche. Calculés sur les
  // rows FILTRÉES pour rester cohérents avec ce qui est affiché.
  const personaSet = new Set(filteredTechlistRows.map((r) => r.persona_key))
  const totalPersonae = personaSet.size
  const totalRows = filteredTechlistRows.length
  const validatedRows = filteredTechlistRows.filter((r) =>
    ['contrat_signe', 'paie_en_cours', 'paie_terminee'].includes(r.movinmotion_statut),
  ).length
  const aTrierCount = filteredUncategorized.length

  return (
    <div className="flex flex-col gap-3">
      {/* Header compact + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: 'var(--txt-2)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Crew list
          </h2>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt-3)' }}>
            <span>·</span>
            <span><strong style={{ color: 'var(--txt-2)' }}>{totalPersonae}</strong> personne{totalPersonae > 1 ? 's' : ''}</span>
            <span>·</span>
            <span><strong style={{ color: 'var(--txt-2)' }}>{totalRows}</strong> attribution{totalRows > 1 ? 's' : ''}</span>
            <span>·</span>
            <span style={{ color: 'var(--green)' }}>{validatedRows} validée{validatedRows > 1 ? 's' : ''}</span>
            {aTrierCount > 0 && (
              <>
                <span>·</span>
                <span style={{ color: 'var(--amber)' }}>{aTrierCount} à trier</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* P4-PREVIEW — Mode "vue seule" : ouvre une modale plein écran
              dans le style de la page share publique, mais sur les données
              admin locales (pas de token). Utile pour consulter / projeter
              la crew list sans l'UI dense d'édition. */}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            title="Mode vue seule (lecture)"
            aria-label="Mode vue seule"
            className="text-xs p-1.5 rounded-md transition-colors flex items-center"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-2)'
            }}
          >
            <Eye className="w-3.5 h-3.5" />
          </button>

          {/* P4.1 — Dropdown Exporter (PDF tous lots / par lot) */}
          <button
            ref={exportTriggerRef}
            type="button"
            onClick={() => (exportOpen ? setExportOpen(false) : openExportMenu())}
            disabled={exporting || techlistRows.length === 0}
            title="Exporter ou partager la crew list"
            className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
            style={{
              background: exportOpen ? 'var(--bg-elev)' : 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              opacity: exporting || techlistRows.length === 0 ? 0.5 : 1,
              cursor: exporting || techlistRows.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Share2 className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Partager</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Toggle infos sensibles — neutre quand off, bleu quand on */}
          <button
            type="button"
            onClick={() => setShowSensitive((v) => !v)}
            className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
            style={{
              background: showSensitive ? 'var(--blue-bg)' : 'transparent',
              color: showSensitive ? 'var(--blue)' : 'var(--txt-2)',
              border: `1px solid ${showSensitive ? 'var(--blue-brd)' : 'var(--brd)'}`,
            }}
            title={
              showSensitive
                ? 'Masquer téléphones et emails'
                : 'Afficher téléphones et emails'
            }
          >
            {showSensitive ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                Coordonnées visibles
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                Coordonnées masquées
              </>
            )}
          </button>

          {/* Ajouter */}
          {canEdit && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-opacity"
              style={{
                background: 'var(--blue)',
                color: '#fff',
                border: '1px solid var(--blue)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter à l&rsquo;équipe
            </button>
          )}
        </div>
      </div>

      {/* Boîte "À trier" — stylée distinctement, en haut.
          TOUJOURS montée dans le DOM pour rester une cible de drop valide
          pendant le drag (décatégoriser une row = la déposer dans À trier).
          Visuellement compactée quand vide ET aucun drag en cours, expansée
          dès qu'il y a des rows OU qu'un drag est en cours.
          Masquée seulement quand un lot est sélectionné ET qu'elle est vide
          (les rows ad-hoc sans devis_line_id n'ont pas de lot). */}
      {(!selectedLotId || filteredUncategorized.length > 0) && (
      <UncategorizedBox
        rows={filteredUncategorized}
        canEdit={canEdit}
        showSensitive={showSensitive}
        lotInfoForRow={lotInfoForRow}
        othersEditingByRow={othersEditingByRow}
        setMyEditingRowId={setMyEditingRowId}
        onOpenMembre={(row) => setMembreDrawerKey(personaKey(row))}
        isDragOver={dragOverCat === SENTINEL_UNCATEGORIZED}
        draggingId={draggingId}
        dragOverRow={dragOverRow}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOverCat(SENTINEL_UNCATEGORIZED)
        }}
        onDragLeave={() => setDragOverCat(null)}
        onDrop={() => handleDropOnCategory(SENTINEL_UNCATEGORIZED)}
        onDragStartRow={(row) => setDraggingId(row.id)}
        onDragEndRow={() => {
          setDraggingId(null)
          setDragOverCat(null)
          setDragOverRow(null)
        }}
        onDragOverRow={(rowId, position) =>
          setDragOverRow({ id: rowId, position })
        }
        onDragLeaveRow={() => {
          // léger debounce visuel — ne reset pas si on entre une autre row
        }}
        onDropOnRow={handleDropOnRow}
        onUpdateRow={updateMember}
        onUpdatePersona={updatePersona}
        onRemoveRow={(rowId) => removeMember(rowId)}
        onOpenPresence={setPresenceFor}
        onOpenAttach={setAttachFor}
        onDetach={(rowId) => detachMember(rowId)}
      />
      )}

      {/* Sections par catégorie. Quand un lot est sélectionné, on masque les
          catégories vides (sinon le message "Glisser une ligne ici" pollue
          la vue alors que le drop dans cette section ne correspondrait pas
          au lot filtré). En mode "Tous", on garde toutes les catégories
          pour conserver les zones de drop. */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {allCategories
          .filter((cat) =>
            !selectedLotId || (filteredByCategory[cat] || []).length > 0,
          )
          .map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            rows={filteredByCategory[cat] || []}
            canEdit={canEdit}
            showSensitive={showSensitive}
            lotInfoForRow={lotInfoForRow}
            othersEditingByRow={othersEditingByRow}
            setMyEditingRowId={setMyEditingRowId}
            onOpenMembre={(row) => setMembreDrawerKey(personaKey(row))}
            onRenameCategory={(newName) => {
              // Si la catégorie était dans extraCategories (vide), on la
              // remplace dans la liste locale sans toucher la DB. Si elle
              // contient des rows, on bulk-rename via renameCategory.
              const trimmed = (newName || '').trim()
              if (!trimmed || trimmed === cat) return
              const isExtraEmpty = extraCategories.includes(cat) &&
                !members.some((m) => m.category === cat)
              if (isExtraEmpty) {
                setExtraCategories((prev) =>
                  prev.map((c) => (c === cat ? trimmed : c)),
                )
              } else {
                renameCategory(cat, trimmed)
              }
            }}
            onDeleteCategory={() => handleDeleteCategory(cat)}
            draggingCategory={draggingCategory}
            onCategoryDragStart={(c) => setDraggingCategory(c)}
            onCategoryDragEnd={() => setDraggingCategory(null)}
            onCategoryDrop={(targetCat, position) =>
              handleReorderCategories(draggingCategory, targetCat, position)
            }
            isDragOver={dragOverCat === cat}
            draggingId={draggingId}
            dragOverRow={dragOverRow}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverCat(cat)
            }}
            onDragLeave={() => setDragOverCat(null)}
            onDrop={() => handleDropOnCategory(cat)}
            onDragStartRow={(row) => setDraggingId(row.id)}
            onDragEndRow={() => {
              setDraggingId(null)
              setDragOverCat(null)
              setDragOverRow(null)
            }}
            onDragOverRow={(rowId, position) =>
              setDragOverRow({ id: rowId, position })
            }
            onDragLeaveRow={() => {
              // léger debounce visuel — ne reset pas si on entre une autre row
            }}
            onDropOnRow={handleDropOnRow}
            onUpdateRow={updateMember}
            onUpdatePersona={updatePersona}
            onRemoveRow={(rowId) => removeMember(rowId)}
            onOpenPresence={setPresenceFor}
            onOpenAttach={setAttachFor}
            onDetach={(rowId) => detachMember(rowId)}
          />
        ))}

        {/* P4-CATEGORIES : bouton "+ Nouvelle catégorie" en bas de la liste.
            Ouvre la modal stylée NewCategoryModal. La catégorie est stockée
            en localStorage (extraCategories), visible immédiatement comme
            drop target, devient "réelle" en DB dès qu'une row est déposée
            dedans (via category sur projet_membres). */}
        {canEdit && (
          <button
            type="button"
            onClick={() => setNewCatOpen(true)}
            className="w-full px-3 py-2.5 text-xs flex items-center justify-center gap-1.5 transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--txt-3)',
              borderTop: '1px dashed var(--brd-sub)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            title="Ajouter une catégorie personnalisée"
          >
            <Plus className="w-3.5 h-3.5" />
            Nouvelle catégorie
          </button>
        )}

        {totalRows === 0 && filteredUncategorized.length === 0 && (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ color: 'var(--txt-3)' }}
          >
            <Users
              className="w-8 h-8 mx-auto mb-2 opacity-50"
              style={{ color: 'var(--txt-3)' }}
            />
            {selectedLotId ? (
              <>
                Aucune attribution dans ce lot pour l&rsquo;instant.
                <p className="text-[11px] mt-2 opacity-70">
                  Désactivez le filtre pour voir toute l&rsquo;équipe.
                </p>
              </>
            ) : (
              <>
                Aucune personne dans l&rsquo;équipe pour l&rsquo;instant.
                {canEdit && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setAddOpen(true)}
                      className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5"
                      style={{ background: 'var(--blue)', color: '#fff' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter le premier membre
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      <AddMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        contacts={contacts}
        categories={categories}
        defaultCategory={null}
        onCreateContact={addContact}
        onAddMember={addMember}
        lots={lotsWithRef}
      />

      <PresenceCalendarModal
        open={Boolean(presenceFor)}
        onClose={() => setPresenceFor(null)}
        personaName={presenceFor?.persona ? fullNameFromPersona(presenceFor.persona) : ''}
        persona={presenceFor?.persona || null}
        onSave={(fields) =>
          presenceFor && updatePersona(presenceFor.persona_key, fields)
        }
        periodes={periodes}
        anchorDate={tournageAnchor}
      />

      <AttachModal
        open={Boolean(attachFor)}
        onClose={() => setAttachFor(null)}
        childRow={attachFor}
        allMembers={members}
        onAttach={attachMember}
        lineLotMap={lineLotMap}
        lotInfoMap={lotInfoMap}
      />

      {/* P4-CATEGORIES — Modal d'ajout de catégorie personnalisée */}
      <NewCategoryModal
        open={newCatOpen}
        existingCategories={allCategories}
        onClose={() => setNewCatOpen(false)}
        onCreate={(name) => {
          const upper = name.trim().toUpperCase()
          if (!upper) return
          if (allCategories.includes(upper)) {
            notify.error('Cette catégorie existe déjà.')
            return
          }
          setExtraCategories((prev) => [...prev, upper])
          setNewCatOpen(false)
        }}
      />

      {/* P4-PREVIEW — Modal plein écran "vue seule" (lecture).
          Respecte le filtre par lot actif : on passe les rows déjà
          filtrées + le selectedLotId pour que le modal affiche le scope
          dans son header. */}
      <EquipePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        project={project}
        org={org}
        lots={lotsWithRef}
        members={filteredTechlistRows}
        lineLotMap={lineLotMap}
        selectedLotId={selectedLotId}
        categoryOrder={allCategories}
      />

      {/* P4.3 — Drawer "Vue par membre" : ouvre toutes les attributions
          d'une personne sur le projet + sa logistique persona-level dans
          un panneau latéral consolidé. Déclenché par clic sur le nom dans
          AttributionRow. */}
      <MembreDrawer
        open={Boolean(membreDrawerKey)}
        onClose={() => setMembreDrawerKey(null)}
        personaKeyValue={membreDrawerKey}
        members={members}
        canEdit={canEdit}
        lots={lotsWithRef}
        lotInfoMap={lotInfoMap}
        lineLotMap={lineLotMap}
        categories={categories}
        onUpdateMember={updateMember}
        onUpdatePersona={updatePersona}
        onRemoveMember={removeMember}
        onDetachMember={detachMember}
        onOpenPresence={(persona) => {
          setPresenceFor({ persona, persona_key: persona.key })
        }}
        // P4-DRAWER : action "Rattacher à un autre poste" depuis le drawer.
        // On ouvre l'AttachModal global de TechListView en passant la row
        // comme childRow ; le drawer se ferme côté MembreDrawer pour ne
        // pas empiler les panneaux.
        onOpenAttach={(row) => setAttachFor(row)}
        // P4-DRAWER : édition contact annuaire depuis le drawer (admin).
        // Disponible uniquement si canEdit (gating UI + RLS côté DB).
        onUpdateContact={canEdit ? updateContact : null}
      />

      {/* P4.1 — Preview du PDF généré (réutilise PdfPreviewModal de Matériel) */}
      <PdfPreviewModal
        open={Boolean(previewState?.open)}
        onClose={closePreview}
        title={previewState?.title}
        url={previewState?.url}
        filename={previewState?.filename}
        onDownload={() => previewState?.download?.()}
      />

      {/* P4.2 — Gestion des liens de partage public */}
      <TechlistShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        projectId={projectId}
        lots={lotsWithRef}
        lotInfoMap={lotInfoMap}
      />

      {/* P4.1 — Dropdown d'export (portal pour ne pas être tronqué) */}
      {exportOpen &&
        createPortal(
          <div
            id="techlist-export-portal"
            className="rounded-xl shadow-2xl overflow-hidden"
            style={{
              position: 'fixed',
              top: exportPos.top,
              // Soit `left` (mobile / trigger à gauche), soit `right` (desktop).
              // openExportMenu() ne set qu'un des deux.
              ...(exportPos.left != null ? { left: exportPos.left } : {}),
              ...(exportPos.right != null ? { right: exportPos.right } : {}),
              width: exportPos.width || 240,
              zIndex: 9999,
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              boxShadow: '0 12px 40px rgba(0,0,0,.5)',
            }}
          >
            {/* Section : Export PDF */}
            <div
              className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide"
              style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd-sub)' }}
            >
              Export PDF
            </div>
            <button
              type="button"
              onClick={() => handleExportPdf('all')}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs"
              style={{ color: 'var(--txt-2)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <FileText className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
              <span className="flex-1">Tous les lots</span>
              <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                {techlistRows.length}
              </span>
            </button>
            {isMultiLot &&
              lotsWithRef.map((lot) => {
                const color = lotInfoMap[lot.id]?.color || 'var(--txt-3)'
                // Compteur : devis_line → lineLotMap, sinon lot_id direct
                const count = techlistRows.filter((r) => {
                  if (r.devis_line_id) return lineLotMap[r.devis_line_id] === lot.id
                  return r.lot_id === lot.id
                }).length
                return (
                  <button
                    key={lot.id}
                    type="button"
                    onClick={() => handleExportPdf(lot.id)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs"
                    style={{ color: 'var(--txt-2)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <FileText className="w-3.5 h-3.5" style={{ color }} />
                    <span className="flex-1 truncate" title={lot.title}>
                      Lot · {lot.title}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                      {count}
                    </span>
                  </button>
                )
              })}

            {/* Section : Partage (P4.2) — ouvre la modale TechlistShareModal */}
            <div
              className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide"
              style={{
                color: 'var(--txt-3)',
                borderTop: '1px solid var(--brd-sub)',
                borderBottom: '1px solid var(--brd-sub)',
              }}
            >
              Partage
            </div>
            <button
              type="button"
              onClick={() => {
                setExportOpen(false)
                setShareOpen(true)
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs"
              style={{ color: 'var(--txt-2)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
              <span className="flex-1">Lien web partageable</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function UncategorizedBox({
  rows,
  canEdit,
  showSensitive,
  lotInfoForRow,
  othersEditingByRow,
  setMyEditingRowId,
  onOpenMembre,
  isDragOver,
  draggingId,
  dragOverRow,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStartRow,
  onDragEndRow,
  onDragOverRow,
  onDragLeaveRow,
  onDropOnRow,
  onUpdateRow,
  onUpdatePersona,
  onRemoveRow,
  onOpenPresence,
  onOpenAttach,
  onDetach,
}) {
  const count = rows.length
  // On affiche TOUJOURS la boîte (même vide) pour servir de cible de drop.
  // Quand vide ET aucun drag en cours, on la "déprime" visuellement
  // (couleurs neutres + opacité réduite), MAIS sans changer la taille ni
  // les paddings — sinon le layout shift pendant un drag perturbe les
  // drop targets HTML5 et casse le D&D entre catégories.
  const isDragging = draggingId != null
  const isMuted = count === 0 && !isDragging
  const accent = isMuted ? 'var(--txt-3)' : 'var(--amber)'
  const accentBg = isMuted ? 'transparent' : 'var(--amber-bg)'
  const accentBrd = isMuted ? 'var(--brd-sub)' : 'var(--amber-brd)'
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="rounded-lg overflow-hidden"
      style={{
        background: isDragOver ? 'var(--amber-bg)' : 'var(--bg-surf)',
        border: `2px dashed ${isDragOver ? 'var(--amber)' : accentBrd}`,
        opacity: isMuted ? 0.6 : 1,
        // Pas de transition (sinon flicker pendant drag)
      }}
    >
      {/* Header — taille FIXE, seules les couleurs changent selon l'état */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: accentBg,
          borderBottom: count > 0 ? '1px solid var(--amber-brd)' : 'none',
        }}
      >
        <Inbox className="w-3.5 h-3.5" style={{ color: accent }} />
        <span
          className="text-xs font-bold uppercase tracking-wide"
          style={{ color: accent }}
        >
          À trier
        </span>
        <span className="text-xs" style={{ color: accent, opacity: 0.7 }}>
          · {count}
        </span>
        {!isMuted && (
          <span
            className="ml-auto text-[10px] italic"
            style={{ color: 'var(--amber)', opacity: 0.7 }}
          >
            Glissez les lignes vers une catégorie pour les classer
          </span>
        )}
      </div>

      {/* Body :
          - count > 0 → on liste les rows
          - count === 0 → AUCUN body (juste le header). Le feedback de drop
            cible se fait via le changement de background du header (couleur
            amber qui s'allume au hover dragover).
          (Pas de layout shift entre idle et drag → D&D HTML5 stable.) */}
      {count > 0 &&
        rows.map((row) => (
          <AttributionRow
            key={row.id}
            row={row}
            canEdit={canEdit}
            showSensitive={showSensitive}
            lotInfo={lotInfoForRow ? lotInfoForRow(row) : null}
            editingByOther={othersEditingByRow?.get(row.id) || null}
            onEditingChange={setMyEditingRowId}
            onOpenMembre={onOpenMembre}
            isDragging={draggingId === row.id}
            dropIndicator={
              dragOverRow?.id === row.id ? dragOverRow.position : null
            }
            onDragStart={onDragStartRow}
            onDragEnd={onDragEndRow}
            onDragOverRow={onDragOverRow}
            onDragLeaveRow={onDragLeaveRow}
            onDropOnRow={onDropOnRow}
            onUpdateRow={onUpdateRow}
            onUpdatePersona={onUpdatePersona}
            onRemoveRow={() => onRemoveRow(row.id)}
            onOpenPresence={() => onOpenPresence(row)}
            onAttach={() => onOpenAttach(row)}
            onDetach={row.parent_membre_id ? () => onDetach(row.id) : null}
          />
        ))}
    </div>
  )
}

function CategorySection({
  category,
  rows,
  canEdit,
  showSensitive,
  lotInfoForRow,
  othersEditingByRow,
  setMyEditingRowId,
  onOpenMembre,
  onRenameCategory,
  onDeleteCategory,
  draggingCategory,
  onCategoryDragStart,
  onCategoryDragEnd,
  onCategoryDrop,
  isDragOver,
  draggingId,
  dragOverRow,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStartRow,
  onDragEndRow,
  onDragOverRow,
  onDragLeaveRow,
  onDropOnRow,
  onUpdateRow,
  onUpdatePersona,
  onRemoveRow,
  onOpenPresence,
  onOpenAttach,
  onDetach,
}) {
  const [expanded, setExpanded] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(category)
  // Reset le draft quand category change (ex: rename concurrent via Realtime)
  useEffect(() => {
    if (!editingName) setDraftName(category)
  }, [category, editingName])
  // Drop indicator pour le drag de catégorie sur ce header (above/below).
  // null si aucun drag de catégorie en cours.
  const [catDropPosition, setCatDropPosition] = useState(null)
  const count = rows.length
  const isBeingDragged = draggingCategory === category
  const canShowCatDrop =
    draggingCategory && draggingCategory !== category

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        background: isDragOver ? 'var(--blue-bg)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Header section : clic sur chevron OU titre = collapse/expand.
          Boutons crayon ✏️ + corbeille 🗑️ visibles au hover.
          Drag handle ⋮⋮ (visible au hover) pour réorganiser les catégories
          entre elles. Drop possible sur ce header pour repositionner. */}
      <div
        draggable={canEdit && !editingName}
        onDragStart={(e) => {
          if (!canEdit || editingName) return
          // Marqueur custom pour différencier d'un drag de row (text/plain)
          e.dataTransfer.setData('application/x-equipe-category', category)
          e.dataTransfer.effectAllowed = 'move'
          onCategoryDragStart?.(category)
        }}
        onDragEnd={() => onCategoryDragEnd?.()}
        onDragOver={(e) => {
          if (!canShowCatDrop) return
          // Vérifie qu'on est bien sur un drag de catégorie (pas une row)
          if (
            !e.dataTransfer.types.includes('application/x-equipe-category')
          ) {
            return
          }
          e.preventDefault()
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          const mid = rect.top + rect.height / 2
          setCatDropPosition(e.clientY < mid ? 'before' : 'after')
        }}
        onDragLeave={() => setCatDropPosition(null)}
        onDrop={(e) => {
          if (!canShowCatDrop) return
          if (
            !e.dataTransfer.types.includes('application/x-equipe-category')
          ) {
            return
          }
          e.preventDefault()
          e.stopPropagation()
          const pos = catDropPosition || 'before'
          setCatDropPosition(null)
          onCategoryDrop?.(category, pos)
        }}
        className="group/cat w-full flex items-center gap-2 px-3 py-2 transition-colors"
        style={{
          background: 'var(--bg-elev)',
          borderBottom: '1px solid var(--brd-sub)',
          borderTop: '1px solid var(--brd-sub)',
          opacity: isBeingDragged ? 0.4 : 1,
          // Indicateur visuel : barre bleue au-dessus ou en-dessous selon
          // la position de drop pour la catégorie en train d'être glissée.
          boxShadow:
            catDropPosition === 'before'
              ? 'inset 0 3px 0 0 var(--blue)'
              : catDropPosition === 'after'
                ? 'inset 0 -3px 0 0 var(--blue)'
                : 'none',
          cursor: canEdit && !editingName ? 'grab' : 'default',
        }}
      >
        {/* Drag handle visible au hover — signale clairement la
            possibilité de réordonner */}
        {canEdit && (
          <span
            className="transition-opacity opacity-0 group-hover/cat:opacity-40"
            style={{ color: 'var(--txt-3)' }}
            title="Glisser pour réordonner"
          >
            <GripVertical className="w-3 h-3" />
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] transition-transform"
          style={{
            color: 'var(--txt-3)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
          aria-label={expanded ? 'Replier' : 'Déplier'}
        >
          ▶
        </button>
        {editingName ? (
          <input
            type="text"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value.toUpperCase())}
            onBlur={() => {
              const trimmed = draftName.trim()
              if (trimmed && trimmed !== category) onRenameCategory?.(trimmed)
              setEditingName(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraftName(category)
                setEditingName(false)
              }
            }}
            className="text-xs font-bold uppercase tracking-wide px-1 py-0.5 rounded outline-none flex-1"
            style={{
              background: 'var(--bg-surf)',
              color: 'var(--txt)',
              border: '1px solid var(--blue)',
              minWidth: 140,
            }}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-bold uppercase tracking-wide text-left"
              style={{
                color: 'var(--txt-2)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {category}
            </button>
            <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
              · {count}
            </span>
            {/* Bouton renommer : visible uniquement au hover du header
                pour ne pas saturer la vue. Clic explicite = entre en
                mode édition. */}
            {canEdit && onRenameCategory && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setDraftName(category)
                  setEditingName(true)
                }}
                className="ml-1 p-1 rounded transition-opacity opacity-0 group-hover/cat:opacity-60 hover:!opacity-100"
                style={{
                  color: 'var(--txt-3)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title="Renommer la catégorie"
                aria-label="Renommer la catégorie"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            )}
            {/* Bouton supprimer : disponible UNIQUEMENT pour les catégories
                vides (count === 0). Confirmation avant suppression. Pour
                les catégories non vides, l'admin doit d'abord déplacer/
                retirer les attributions. */}
            {canEdit && onDeleteCategory && count === 0 && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation()
                  const ok = await confirm({
                    title: 'Supprimer la catégorie',
                    message: `Retirer la catégorie « ${category} » de la Crew list ?`,
                    confirmLabel: 'Supprimer',
                    destructive: true,
                  })
                  if (ok) onDeleteCategory()
                }}
                className="p-1 rounded transition-opacity opacity-0 group-hover/cat:opacity-60 hover:!opacity-100"
                style={{
                  color: 'var(--red)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title="Supprimer cette catégorie vide"
                aria-label="Supprimer la catégorie"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Rows */}
      {expanded && (
        <div>
          {count === 0 ? (
            <div
              className="px-4 py-3 text-center text-[11px] italic"
              style={{ color: 'var(--txt-3)', background: 'var(--bg-row)', opacity: 0.6 }}
            >
              {isDragOver ? 'Lâcher ici' : 'Glisser une ligne ici pour la classer dans cette catégorie.'}
            </div>
          ) : (
            rows.map((row) => (
              <AttributionRow
                key={row.id}
                row={row}
                canEdit={canEdit}
                showSensitive={showSensitive}
                lotInfo={lotInfoForRow ? lotInfoForRow(row) : null}
                editingByOther={othersEditingByRow?.get(row.id) || null}
                onEditingChange={setMyEditingRowId}
                onOpenMembre={onOpenMembre}
                isDragging={draggingId === row.id}
                dropIndicator={
                  dragOverRow?.id === row.id ? dragOverRow.position : null
                }
                onDragStart={onDragStartRow}
                onDragEnd={onDragEndRow}
                onDragOverRow={onDragOverRow}
                onDragLeaveRow={onDragLeaveRow}
                onDropOnRow={onDropOnRow}
                onUpdateRow={onUpdateRow}
                onUpdatePersona={onUpdatePersona}
                onRemoveRow={() => onRemoveRow(row.id)}
                onOpenPresence={() => onOpenPresence(row)}
                onAttach={() => onOpenAttach(row)}
                onDetach={row.parent_membre_id ? () => onDetach(row.id) : null}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// NewCategoryModal — Modal stylé pour ajouter une catégorie personnalisée
// ════════════════════════════════════════════════════════════════════════════
//
// Remplace le window.prompt natif par une popup cohérente avec le reste de
// l'app (même look & feel que AttachModal / AddMemberModal).
//
// Comportement :
//   • Auto-focus du champ à l'ouverture.
//   • Affichage en majuscules (visuel uniquement, la valeur est uppercased
//     au submit).
//   • Validation inline si la catégorie existe déjà (case-insensitive vs
//     existingCategories normalisé en upper).
//   • Enter = valider (si non vide et non duplicate).
//   • Escape = annuler.
//   • Click hors carte = annuler.
//
// Le composant onCreate reçoit le nom brut (trimé). C'est l'appelant qui
// upper-case et qui décide quoi faire (push dans extraCategories en
// localStorage ou autre). NewCategoryModal ne ferme PAS la modal lui-même
// après onCreate — c'est l'appelant qui gère via onClose() (cohérent avec
// AttachModal et AddMemberModal).
// ════════════════════════════════════════════════════════════════════════════
function NewCategoryModal({ open, onClose, onCreate, existingCategories = [] }) {
  const [name, setName] = useState('')
  const inputRef = useRef(null)

  // Reset à l'ouverture + auto-focus
  useEffect(() => {
    if (open) {
      setName('')
      // micro-delay pour laisser le portal monter avant de focus
      const t = setTimeout(() => {
        inputRef.current?.focus()
      }, 30)
      return () => clearTimeout(t)
    }
  }, [open])

  // Escape pour fermer
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const trimmed = name.trim()
  const upper = trimmed.toUpperCase()
  const existsUpper = (existingCategories || []).map((c) => String(c || '').toUpperCase())
  const isDuplicate = trimmed.length > 0 && existsUpper.includes(upper)
  const canSubmit = trimmed.length > 0 && !isDuplicate

  function handleSubmit() {
    if (!canSubmit) return
    onCreate?.(trimmed)
    // l'appelant ferme via onClose (cohérent avec le reste du codebase)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-md flex flex-col rounded-xl shadow-xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Plus className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Nouvelle catégorie
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Crew list — bloc personnalisé
            </p>
          </div>
        </header>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <label
            className="block text-xs font-medium"
            style={{ color: 'var(--txt-2)' }}
          >
            Nom de la catégorie
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Ex. RÉGIE, MAQUILLAGE…"
            maxLength={40}
            className="w-full px-3 py-2 text-sm rounded-md outline-none transition-colors"
            style={{
              background: 'var(--bg-elev)',
              border: `1px solid ${
                isDuplicate ? 'var(--red, #ef4444)' : 'var(--brd-sub)'
              }`,
              color: 'var(--txt)',
              textTransform: 'uppercase',
            }}
            onFocus={(e) => {
              if (!isDuplicate) e.currentTarget.style.borderColor = 'var(--blue)'
            }}
            onBlur={(e) => {
              if (!isDuplicate) e.currentTarget.style.borderColor = 'var(--brd-sub)'
            }}
          />
          {isDuplicate ? (
            <p className="text-xs" style={{ color: 'var(--red, #ef4444)' }}>
              Cette catégorie existe déjà.
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              La catégorie apparaîtra immédiatement comme zone de dépôt. Elle
              devient permanente dès qu&rsquo;une ligne y est déposée.
            </p>
          )}
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd-sub)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5"
            style={{
              background: canSubmit ? 'var(--blue)' : 'var(--bg-elev)',
              color: canSubmit ? '#fff' : 'var(--txt-3)',
              border: '1px solid transparent',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.6,
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Créer
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// useDevis — état + persistance + (à venir) realtime/présence d'un devis
// ════════════════════════════════════════════════════════════════════════════
//
// Extrait de DevisEditor (refactor R1) : centralise le state données, l'autosave
// (1,5 s), les mutations (lignes / catégories / ajustements) et la synthèse
// mémoïsée. L'éditeur consomme ce hook ; l'état purement UI (collapsed, modales,
// toggles, preview PDF) reste dans le composant.
//
// Optimisation R1 : sauvegarde UNIQUEMENT les lignes modifiées (suivi `dirty`).
// R2 (realtime) et R3 (présence) viennent se greffer ici.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { confirm } from '../../lib/confirm'
import { calcSynthese, CATS_HUMAINS, TAUX_DEFAUT } from '../../lib/cotisations'
import { applyCategoryDansMarge } from '../../lib/devisLines'
import { BLOCS_CANONIQUES, getBlocInfo as _getBlocInfoByName } from '../../lib/blocs'
import { normalizeRegime, EMPTY_LINE, EMPTY_GLOBAL } from './constants'

function getBlocInfo(cat) {
  return _getBlocInfoByName(cat.name)
}

const lineKey = (l) => l.id || l._tempId

export function useDevis({ devisId, projectId, org }) {
  const [devis, setDevis] = useState(null)
  const [project, setProject] = useState(null)
  const [client, setClient] = useState(null)
  const [categories, setCategories] = useState([])
  const [taux, setTaux] = useState(TAUX_DEFAUT)
  const [bdd, setBdd] = useState([])
  const [globalAdj, setGlobalAdj] = useState(EMPTY_GLOBAL)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false) // modifs locales non encore persistées
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState(null)

  const isSaving = useRef(false)
  const pendingSave = useRef(null)
  const insertingTempIds = useRef(new Set())
  const hasChanges = useRef(false)
  // Compteur incrémenté à CHAQUE édition locale → permet de savoir si de
  // nouvelles modifs sont survenues pendant une sauvegarde en cours (pour
  // remettre `dirty` à false uniquement quand tout est bien persisté).
  const editSeq = useRef(0)
  const bumpEdit = useCallback(() => {
    editSeq.current += 1
    hasChanges.current = true
    setDirty(true)
  }, [])
  // R1 : lignes réellement modifiées depuis le dernier save (clé = id|_tempId).
  const dirtyLines = useRef(new Set())
  const markDirty = useCallback(
    (key) => {
      bumpEdit()
      if (key) dirtyLines.current.add(key)
    },
    [bumpEdit],
  )
  // R2 : ids fraîchement insérés par NOUS (ligne ou catégorie). Sert à ignorer
  // l'echo Realtime de notre propre INSERT (sinon doublon le temps que le
  // remplacement _tempId→id local se propage). Les UPDATE/DELETE sont
  // idempotents donc pas besoin de garde. Expire seul après 5 s.
  const recentInserts = useRef(new Set())
  const guardInsert = (id) => {
    if (!id) return
    recentInserts.current.add(id)
    setTimeout(() => recentInserts.current.delete(id), 5000)
  }

  // ── Chargement ────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: dv } = await supabase.from('devis').select('*').eq('id', devisId).single()
      setDevis(dv)
      setGlobalAdj({
        marge_globale_pct: Number(dv?.marge_globale_pct) || 0,
        assurance_pct: Number(dv?.assurance_pct) || 0,
        remise_globale_pct: Number(dv?.remise_globale_pct) || 0,
        remise_globale_montant: Number(dv?.remise_globale_montant) || 0,
      })

      const { data: cats } = await supabase
        .from('devis_categories')
        .select('*')
        .eq('devis_id', devisId)
        .order('sort_order')
      const { data: lines } = await supabase
        .from('devis_lines')
        .select('*')
        .eq('devis_id', devisId)
        .order('sort_order')
      const catsWithLines = (cats || []).map((cat) => ({
        ...cat,
        lines: (lines || [])
          .filter((l) => l.category_id === cat.id)
          .map((l) => ({ ...l, regime: normalizeRegime(l.regime) })),
      }))
      setCategories(catsWithLines)

      const { data: proj } = await supabase
        .from('projects')
        .select('*, clients(*)')
        .eq('id', projectId)
        .single()
      setProject(proj)
      setClient(proj?.clients || null)

      const { data: bddData } = await supabase.from('produits_bdd').select('*').order('categorie')
      setBdd(bddData || [])

      // Taux cotisations (par org) — table cotisation_config (lignes key/value).
      if (org?.id) {
        const { data: confData } = await supabase
          .from('cotisation_config')
          .select('*')
          .eq('org_id', org.id)
        if (confData?.length) {
          const t = { ...TAUX_DEFAUT }
          confData.forEach((c) => { t[c.key] = Number(c.value) })
          setTaux(t)
        }
      }
    } catch (err) {
      console.error('[useDevis] loadAll', err)
    } finally {
      hasChanges.current = false
      dirtyLines.current.clear()
      setDirty(false)
      setLoading(false)
    }
  }, [devisId, projectId, org?.id])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── Sauvegarde ──────────────────────────────────────────────────────────────
  const doSave = useCallback(
    async (cats, dv, adj, dirtySnapshot) => {
      if (isSaving.current) {
        pendingSave.current = { cats, dv, adj, dirty: dirtySnapshot }
        return
      }
      if (!dv) return
      isSaving.current = true
      const seqAtStart = editSeq.current // pour détecter des modifs pendant le save
      setSaving(true)
      setSaveError(null)
      const errors = []
      try {
        for (const cat of cats) {
          for (const line of cat.lines) {
            const key = lineKey(line)
            // R1 : on ne réécrit que les lignes nouvelles ou modifiées.
            const isNew = !line.id
            if (!isNew && !dirtySnapshot.has(key)) continue

            const payload = {
              devis_id: devisId,
              category_id: cat.id,
              ref: line.ref,
              produit: line.produit,
              description: line.description,
              regime: line.regime,
              use_line: line.use_line,
              dans_marge: true, // géré au niveau catégorie
              nb: line.nb ?? 1,
              quantite: line.quantite,
              unite: line.unite,
              tarif_ht: line.tarif_ht,
              cout_ht: line.cout_ht ?? null,
              remise_pct: line.remise_pct,
              sort_order: line.sort_order,
              is_crew: CATS_HUMAINS.includes(line.regime),
            }
            if (line.id) {
              const { error } = await supabase.from('devis_lines').update(payload).eq('id', line.id)
              if (error) {
                console.error('[useDevis] UPDATE ligne', error, payload)
                errors.push(`UPDATE: ${error.message}`)
              }
            } else if (!insertingTempIds.current.has(line._tempId)) {
              insertingTempIds.current.add(line._tempId)
              const { data: newLine, error } = await supabase
                .from('devis_lines')
                .insert(payload)
                .select()
                .single()
              insertingTempIds.current.delete(line._tempId)
              if (error) {
                console.error('[useDevis] INSERT ligne', error, payload)
                errors.push(`INSERT: ${error.message}`)
              } else if (newLine) {
                guardInsert(newLine.id)
                setCategories((prev) =>
                  prev.map((c) =>
                    c.id === cat.id
                      ? {
                          ...c,
                          lines: c.lines.map((l) =>
                            l._tempId === line._tempId
                              ? // On CONSERVE _tempId : la sheet mobile (et tout
                                // consommateur keyé dessus) garde sa cible après
                                // le remplacement par la ligne serveur.
                                { ...newLine, _tempId: line._tempId }
                              : l,
                          ),
                        }
                      : c,
                  ),
                )
              }
            }
          }
        }

        const { error: devisErr } = await supabase
          .from('devis')
          .update({
            updated_at: new Date().toISOString(),
            status: dv.status,
            title: dv.title ?? null,
            marge_globale_pct: adj.marge_globale_pct,
            assurance_pct: adj.assurance_pct,
            remise_globale_pct: adj.remise_globale_pct,
            remise_globale_montant: adj.remise_globale_montant,
            tva_rate: dv.tva_rate != null ? Number(dv.tva_rate) : 20,
            acompte_pct: dv.acompte_pct != null ? Number(dv.acompte_pct) : 30,
          })
          .eq('id', devisId)
        if (devisErr) {
          console.error('[useDevis] devis update', devisErr)
          errors.push(`Devis: ${devisErr.message}`)
        }

        if (errors.length === 0) {
          // Les lignes sauvegardées ne sont plus "dirty".
          dirtySnapshot.forEach((k) => dirtyLines.current.delete(k))
          // dirty=false seulement si aucune nouvelle édition pendant le save
          // (sinon une sauvegarde de suivi est déjà programmée).
          if (editSeq.current === seqAtStart) setDirty(false)
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        } else {
          setSaveError(errors.join(' | '))
        }
      } finally {
        isSaving.current = false
        setSaving(false)
        if (pendingSave.current) {
          const p = pendingSave.current
          pendingSave.current = null
          doSave(p.cats, p.dv, p.adj, p.dirty)
        }
      }
    },
    [devisId],
  )

  // Autosave (1,5 s) déclenché seulement après modification utilisateur.
  useEffect(() => {
    if (!devis || loading || !hasChanges.current) return
    const snapCats = categories
    const snapAdj = globalAdj
    const snapDv = devis
    const snapDirty = new Set(dirtyLines.current)
    const timer = setTimeout(() => doSave(snapCats, snapDv, snapAdj, snapDirty), 1500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, globalAdj, devis?.title, devis?.status, devis?.tva_rate, devis?.acompte_pct])

  const saveNow = useCallback(() => {
    hasChanges.current = true
    doSave(categories, devis, globalAdj, new Set(dirtyLines.current))
  }, [categories, devis, globalAdj, doSave])

  // ── R2 : Realtime live-merge (style Google Sheets, pas de verrou) ───────────
  // On écoute les changements DB du devis courant et on les fusionne ligne à
  // ligne dans le state local, SANS jamais écraser un champ en cours d'édition :
  //   - UPDATE ligne : ignoré si la ligne est "dirty" (édition locale non
  //     sauvegardée) — sinon merge des colonnes. L'echo de notre propre save
  //     ré-applique des valeurs identiques → no-op.
  //   - INSERT ligne : ignoré si l'id existe déjà OU vient d'un insert local
  //     (recentInserts) — sinon ajout + tri par sort_order.
  //   - DELETE ligne : retrait par id (no-op si déjà absente).
  //   - Catégories : même logique (insert dédupliqué, update merge, delete).
  //   - Devis (marge/tva/statut/titre) : appliqué seulement si aucune édition
  //     locale en attente (hasChanges) pour ne pas écraser ce que l'user tape.
  useEffect(() => {
    if (!devisId) return undefined

    const onLine = (payload) => {
      const { eventType, new: row, old } = payload
      if (eventType === 'DELETE') {
        const id = old?.id
        if (!id) return
        dirtyLines.current.delete(id)
        setCategories((prev) =>
          prev.map((c) => ({ ...c, lines: c.lines.filter((l) => l.id !== id) })),
        )
        return
      }
      if (!row) return
      const merged = { ...row, regime: normalizeRegime(row.regime) }
      if (eventType === 'INSERT') {
        if (recentInserts.current.has(row.id)) return
        setCategories((prev) => {
          if (prev.some((c) => c.lines.some((l) => l.id === row.id))) return prev
          return prev.map((c) =>
            c.id === row.category_id
              ? { ...c, lines: [...c.lines, merged].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) }
              : c,
          )
        })
        return
      }
      // UPDATE
      if (dirtyLines.current.has(row.id)) return // ne pas écraser l'édition locale
      setCategories((prev) =>
        prev.map((c) => {
          const has = c.lines.some((l) => l.id === row.id)
          // La ligne a pu changer de catégorie → on la retire de l'ancienne
          // et on l'ajoute dans la nouvelle.
          if (c.id === row.category_id) {
            const lines = has
              ? c.lines.map((l) => (l.id === row.id ? { ...l, ...merged } : l))
              : [...c.lines, merged].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            return { ...c, lines }
          }
          return has ? { ...c, lines: c.lines.filter((l) => l.id !== row.id) } : c
        }),
      )
    }

    const onCategory = (payload) => {
      const { eventType, new: row, old } = payload
      if (eventType === 'DELETE') {
        const id = old?.id
        if (id) setCategories((prev) => prev.filter((c) => c.id !== id))
        return
      }
      if (!row) return
      if (eventType === 'INSERT') {
        if (recentInserts.current.has(row.id)) return
        setCategories((prev) =>
          prev.some((c) => c.id === row.id)
            ? prev
            : [...prev, { ...row, lines: [] }].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        )
        return
      }
      // UPDATE : merge des métadonnées de catégorie (préserve les lignes locales).
      setCategories((prev) =>
        prev.map((c) =>
          c.id === row.id
            ? { ...c, name: row.name, dans_marge: row.dans_marge, notes: row.notes, sort_order: row.sort_order }
            : c,
        ),
      )
    }

    const onDevis = (payload) => {
      const row = payload.new
      if (!row) return
      // Ne pas écraser des modifs locales non sauvegardées (titre/sliders).
      if (hasChanges.current) return
      setDevis((p) => ({ ...(p || {}), ...row }))
      setGlobalAdj({
        marge_globale_pct: Number(row.marge_globale_pct) || 0,
        assurance_pct: Number(row.assurance_pct) || 0,
        remise_globale_pct: Number(row.remise_globale_pct) || 0,
        remise_globale_montant: Number(row.remise_globale_montant) || 0,
      })
    }

    const channel = supabase
      .channel(`devis-collab:${devisId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devis_lines', filter: `devis_id=eq.${devisId}` }, onLine)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devis_categories', filter: `devis_id=eq.${devisId}` }, onCategory)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devis', filter: `id=eq.${devisId}` }, onDevis)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [devisId])

  // ── Mutations : ajustements / devis ────────────────────────────────────────
  const updateGlobalAdj = useCallback((field, value) => {
    const num = parseFloat(value) || 0
    bumpEdit()
    setGlobalAdj((p) => ({ ...p, [field]: num }))
  }, [bumpEdit])

  const updateDevisField = useCallback((field, value) => {
    bumpEdit()
    setDevis((p) => ({ ...p, [field]: value }))
  }, [bumpEdit])

  // ── Mutations : catégories (DB immédiate) ──────────────────────────────────
  const addCategory = useCallback(async (name) => {
    const { data: cat } = await supabase
      .from('devis_categories')
      .insert({ devis_id: devisId, name: name || 'NOUVELLE CATÉGORIE', sort_order: categories.length, dans_marge: true })
      .select()
      .single()
    if (cat) {
      guardInsert(cat.id)
      setCategories((prev) => [...prev, { ...cat, lines: [] }])
    }
  }, [devisId, categories.length])

  const addBlocCanonique = useCallback(async (bloc) => {
    const canonicalIdx = BLOCS_CANONIQUES.findIndex((b) => b.key === bloc.key)
    const { data: cat } = await supabase
      .from('devis_categories')
      .insert({ devis_id: devisId, name: bloc.key, sort_order: canonicalIdx * 10, dans_marge: true })
      .select()
      .single()
    if (cat) {
      guardInsert(cat.id)
      setCategories((prev) => [...prev, { ...cat, lines: [] }])
    }
  }, [devisId])

  const renameCategory = useCallback(async (catId, name) => {
    await supabase.from('devis_categories').update({ name }).eq('id', catId)
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, name } : c)))
  }, [])

  const updateCategoryDansMarge = useCallback(async (catId, val) => {
    await supabase.from('devis_categories').update({ dans_marge: val }).eq('id', catId)
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, dans_marge: val } : c)))
  }, [])

  const updateCategoryNotes = useCallback(async (catId, notes) => {
    await supabase.from('devis_categories').update({ notes }).eq('id', catId)
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, notes } : c)))
  }, [])

  const deleteCategory = useCallback(async (catId) => {
    const ok = await confirm({
      title: 'Supprimer le bloc',
      message: 'Cette catégorie et toutes ses lignes seront supprimées définitivement.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    await supabase.from('devis_lines').delete().eq('category_id', catId)
    await supabase.from('devis_categories').delete().eq('id', catId)
    setCategories((prev) => prev.filter((c) => c.id !== catId))
  }, [])

  // ── Mutations : lignes ──────────────────────────────────────────────────────
  const insertLine = useCallback((catId, lineData) => {
    const tempId = `tmp_${Date.now()}_${Math.random()}`
    markDirty(tempId)
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, lines: [...c.lines, { ...EMPTY_LINE, ...lineData, _tempId: tempId, sort_order: c.lines.length }] }
          : c,
      ),
    )
    // Renvoie la clé temporaire : la vue mobile ouvre la sheet d'édition
    // directement sur la ligne créée.
    return tempId
  }, [markDirty])

  const duplicateLine = useCallback((catId, lineId, tempId) => {
    const tempNewId = `tmp_${Date.now()}_${Math.random()}`
    markDirty(tempNewId)
    setCategories((prev) =>
      prev.map((c) => {
        if (c.id !== catId) return c
        const idx = c.lines.findIndex((l) => (lineId ? l.id === lineId : l._tempId === tempId))
        if (idx === -1) return c
        const original = c.lines[idx]
        const clone = { ...original, id: null, _tempId: tempNewId, sort_order: idx + 1 }
        const lines = [...c.lines]
        lines.splice(idx + 1, 0, clone)
        // sort_order recalculé → toutes les lignes du bloc deviennent dirty.
        const renum = lines.map((l, i) => ({ ...l, sort_order: i }))
        renum.forEach((l) => dirtyLines.current.add(lineKey(l)))
        return { ...c, lines: renum }
      }),
    )
  }, [markDirty])

  const deleteLine = useCallback(async (catId, lineId, tempId) => {
    if (lineId) await supabase.from('devis_lines').delete().eq('id', lineId)
    dirtyLines.current.delete(lineId || tempId)
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, lines: c.lines.filter((l) => (lineId ? l.id !== lineId : l._tempId !== tempId)) }
          : c,
      ),
    )
  }, [])

  const updateLine = useCallback((catId, lineId, tempId, field, value) => {
    markDirty(lineId || tempId)
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: c.lines.map((l) => {
                if (!(lineId ? l.id === lineId : l._tempId === tempId)) return l
                const updated = { ...l, [field]: value }
                updated.is_crew = CATS_HUMAINS.includes(updated.regime)
                return updated
              }),
            }
          : c,
      ),
    )
  }, [markDirty])

  const updateLineBatch = useCallback((catId, lineId, tempId, updates) => {
    markDirty(lineId || tempId)
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              lines: c.lines.map((l) => {
                if (!(lineId ? l.id === lineId : l._tempId === tempId)) return l
                const updated = { ...l, ...updates }
                updated.is_crew = CATS_HUMAINS.includes(updated.regime)
                return updated
              }),
            }
          : c,
      ),
    )
  }, [markDirty])

  const reorderLines = useCallback((catId, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return
    bumpEdit()
    setCategories((prev) =>
      prev.map((c) => {
        if (c.id !== catId) return c
        const lines = [...c.lines]
        const [moved] = lines.splice(fromIdx, 1)
        lines.splice(toIdx, 0, moved)
        const renum = lines.map((l, i) => ({ ...l, sort_order: i }))
        renum.forEach((l) => dirtyLines.current.add(lineKey(l)))
        return { ...c, lines: renum }
      }),
    )
  }, [bumpEdit])

  // ── Synthèse (mémoïsée) ─────────────────────────────────────────────────────
  const { allLines, hasAnyRemise, synth } = useMemo(() => {
    const flat = categories.flatMap((c) => c.lines.map((l) => ({ ...l, category_id: c.id })))
    const all = applyCategoryDansMarge(flat, categories)
    const remise = categories.some((c) => c.lines.some((l) => l.remise_pct > 0))
    const s = calcSynthese(all, devis?.tva_rate || 20, devis?.acompte_pct || 30, taux, globalAdj)
    return { allLines: all, hasAnyRemise: remise, synth: s }
  }, [categories, devis?.tva_rate, devis?.acompte_pct, taux, globalAdj])

  return {
    // état
    devis, project, client, categories, taux, bdd, globalAdj,
    saving, saved, dirty, loading, saveError,
    // calculé
    synth, allLines, hasAnyRemise,
    // setters bas-niveau exposés au composant (helpers UI : addCategory canon, etc.)
    setCategories,
    // actions
    reload: loadAll,
    saveNow,
    updateGlobalAdj,
    updateDevisField,
    addCategory,
    addBlocCanonique,
    renameCategory,
    updateCategoryDansMarge,
    updateCategoryNotes,
    deleteCategory,
    insertLine,
    duplicateLine,
    deleteLine,
    updateLine,
    updateLineBatch,
    reorderLines,
    getBlocInfo,
  }
}

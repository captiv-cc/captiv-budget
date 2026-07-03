// ════════════════════════════════════════════════════════════════════════════
// useDevisMobile — état + édition + autosave d'un devis (mode classique)
// ════════════════════════════════════════════════════════════════════════════
//
// Version mobile du useDevis web (packages/web/src/features/devis/useDevis.js),
// volontairement plus simple pour la v1 :
//   - chargement devis + catégories + lignes + taux org + catalogue BDD ;
//   - édition des LIGNES (le pilotage marge/assurance/statuts reste au desk) ;
//   - autosave 1,5 s des lignes modifiées uniquement (suivi dirty, comme web) ;
//   - PAS de realtime/présence en v1 (le desk garde la collab live).
// Les calculs (calcLine/calcSynthese) viennent de @captiv/shared : identiques
// au web au centime près. Les triggers SQL (audit, notifications « modifié »)
// s'appliquent naturellement aux écritures mobiles.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  calcSynthese,
  CATS_HUMAINS,
  TAUX_DEFAUT,
} from '@captiv/shared/lib/cotisations'
import { applyCategoryDansMarge } from '@captiv/shared/lib/devisLines'
import { normalizeRegime, EMPTY_LINE } from '@captiv/shared/lib/devisConstants'

const lineKey = (l) => l.id || l._tempId

export function useDevisMobile(devisId) {
  const { user } = useAuth()
  const [devis, setDevis] = useState(null)
  const [categories, setCategories] = useState([])
  const [taux, setTaux] = useState(TAUX_DEFAUT)
  const [bdd, setBdd] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const dirtyLines = useRef(new Set())
  const dirtyDevis = useRef(false) // ajustements globaux (marge, assurance, TVA…)
  const isSaving = useRef(false)
  const pendingSave = useRef(null)
  const hasChanges = useRef(false)

  // ── Chargement ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!devisId) return
    setLoading(true)
    try {
      const { data: dv } = await supabase.from('devis').select('*').eq('id', devisId).single()
      setDevis(dv)

      const [{ data: cats }, { data: lines }, { data: bddData }] = await Promise.all([
        supabase.from('devis_categories').select('*').eq('devis_id', devisId).order('sort_order'),
        supabase.from('devis_lines').select('*').eq('devis_id', devisId).order('sort_order'),
        supabase.from('produits_bdd').select('*').order('categorie'),
      ])
      setCategories(
        (cats || []).map((cat) => ({
          ...cat,
          lines: (lines || [])
            .filter((l) => l.category_id === cat.id)
            .map((l) => ({ ...l, regime: normalizeRegime(l.regime) })),
        })),
      )
      setBdd(bddData || [])

      // Taux cotisations de l'org (lignes key/value), sinon défauts
      if (user?.id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .maybeSingle()
        if (prof?.org_id) {
          const { data: confData } = await supabase
            .from('cotisation_config')
            .select('*')
            .eq('org_id', prof.org_id)
          if (confData?.length) {
            const t = { ...TAUX_DEFAUT }
            confData.forEach((c) => {
              t[c.key] = Number(c.value)
            })
            setTaux(t)
          }
        }
      }
    } catch (err) {
      console.warn('[useDevisMobile] load', err)
    } finally {
      dirtyLines.current.clear()
      hasChanges.current = false
      setLoading(false)
    }
  }, [devisId, user?.id])

  useEffect(() => {
    load()
  }, [load])

  // ── Sauvegarde (lignes dirty + ajustements devis, comme le web) ────────────
  const doSave = useCallback(
    async (cats, dirtySnapshot, dv, devisDirty) => {
      if (isSaving.current) {
        pendingSave.current = { cats, dirty: dirtySnapshot, dv, devisDirty }
        return
      }
      isSaving.current = true
      setSaving(true)
      setSaveError(null)
      const errors = []
      try {
        for (const cat of cats) {
          for (const line of cat.lines) {
            const key = lineKey(line)
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
              dans_marge: true,
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
              if (error) errors.push(error.message)
            } else {
              const { data: newLine, error } = await supabase
                .from('devis_lines')
                .insert(payload)
                .select()
                .single()
              if (error) {
                errors.push(error.message)
              } else if (newLine) {
                setCategories((prev) =>
                  prev.map((c) =>
                    c.id === cat.id
                      ? {
                          ...c,
                          lines: c.lines.map((l) =>
                            l._tempId === line._tempId
                              ? { ...newLine, _tempId: line._tempId }
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
        // Ajustements globaux du devis (marge, assurance, remise, TVA, acompte)
        if (devisDirty && dv) {
          const { error: dvErr } = await supabase
            .from('devis')
            .update({
              updated_at: new Date().toISOString(),
              marge_globale_pct: Number(dv.marge_globale_pct) || 0,
              assurance_pct: Number(dv.assurance_pct) || 0,
              remise_globale_pct: Number(dv.remise_globale_pct) || 0,
              remise_globale_montant: Number(dv.remise_globale_montant) || 0,
              tva_rate: dv.tva_rate != null ? Number(dv.tva_rate) : 20,
              acompte_pct: dv.acompte_pct != null ? Number(dv.acompte_pct) : 30,
            })
            .eq('id', devisId)
          if (dvErr) errors.push(dvErr.message)
          else dirtyDevis.current = false
        }

        if (errors.length === 0) {
          dirtySnapshot.forEach((k) => dirtyLines.current.delete(k))
        } else {
          setSaveError(errors.join(' | '))
        }
      } finally {
        isSaving.current = false
        setSaving(false)
        if (pendingSave.current) {
          const p = pendingSave.current
          pendingSave.current = null
          doSave(p.cats, p.dirty, p.dv, p.devisDirty)
        }
      }
    },
    [devisId],
  )

  // Autosave 1,5 s après la dernière modification
  useEffect(() => {
    if (loading || !hasChanges.current) return undefined
    const snapCats = categories
    const snapDirty = new Set(dirtyLines.current)
    const snapDv = devis
    const snapDevisDirty = dirtyDevis.current
    const timer = setTimeout(() => doSave(snapCats, snapDirty, snapDv, snapDevisDirty), 1500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, devis])

  const markDirty = useCallback((key) => {
    hasChanges.current = true
    if (key) dirtyLines.current.add(key)
  }, [])

  // Ajustements globaux : édition locale + autosave (mêmes champs que le web)
  const updateDevisField = useCallback((field, value) => {
    hasChanges.current = true
    dirtyDevis.current = true
    setDevis((p) => ({ ...p, [field]: value }))
  }, [])

  // ── Mutations lignes (mêmes signatures que le web) ─────────────────────────
  const insertLine = useCallback(
    (catId, lineData = {}) => {
      const tempId = `tmp_${Date.now()}_${Math.random()}`
      markDirty(tempId)
      setCategories((prev) =>
        prev.map((c) =>
          c.id === catId
            ? {
                ...c,
                lines: [
                  ...c.lines,
                  { ...EMPTY_LINE, ...lineData, _tempId: tempId, sort_order: c.lines.length },
                ],
              }
            : c,
        ),
      )
      return tempId
    },
    [markDirty],
  )

  const updateLine = useCallback(
    (catId, lineId, tempId, field, value) => {
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
    },
    [markDirty],
  )

  const updateLineBatch = useCallback(
    (catId, lineId, tempId, updates) => {
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
    },
    [markDirty],
  )

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

  const duplicateLine = useCallback(
    (catId, lineId, tempId) => {
      const tempNewId = `tmp_${Date.now()}_${Math.random()}`
      markDirty(tempNewId)
      setCategories((prev) =>
        prev.map((c) => {
          if (c.id !== catId) return c
          const idx = c.lines.findIndex((l) => (lineId ? l.id === lineId : l._tempId === tempId))
          if (idx === -1) return c
          const clone = { ...c.lines[idx], id: null, _tempId: tempNewId, sort_order: idx + 1 }
          const lines = [...c.lines]
          lines.splice(idx + 1, 0, clone)
          const renum = lines.map((l, i) => ({ ...l, sort_order: i }))
          renum.forEach((l) => dirtyLines.current.add(lineKey(l)))
          return { ...c, lines: renum }
        }),
      )
    },
    [markDirty],
  )

  // ── Synthèse (mémoïsée, identique au web) ──────────────────────────────────
  const synth = useMemo(() => {
    const flat = categories.flatMap((c) => c.lines.map((l) => ({ ...l, category_id: c.id })))
    const all = applyCategoryDansMarge(flat, categories)
    return calcSynthese(all, devis?.tva_rate || 20, devis?.acompte_pct || 30, taux, {
      marge_globale_pct: Number(devis?.marge_globale_pct) || 0,
      assurance_pct: Number(devis?.assurance_pct) || 0,
      remise_globale_pct: Number(devis?.remise_globale_pct) || 0,
      remise_globale_montant: Number(devis?.remise_globale_montant) || 0,
    })
  }, [categories, devis, taux])

  return {
    devis,
    categories,
    taux,
    bdd,
    synth,
    loading,
    saving,
    saveError,
    reload: load,
    updateDevisField,
    insertLine,
    updateLine,
    updateLineBatch,
    deleteLine,
    duplicateLine,
  }
}

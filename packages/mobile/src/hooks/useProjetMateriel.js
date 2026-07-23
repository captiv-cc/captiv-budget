// ════════════════════════════════════════════════════════════════════════════
// useProjetMateriel — matériel d'un projet (version active : blocs → items)
// ════════════════════════════════════════════════════════════════════════════
//
// Lecture seule. Charge la version active (matos_versions), ses blocs
// (matos_blocks), items (matos_items) + loueurs (matos_item_loueurs +
// fournisseurs). outil_key = 'materiel'.
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadCache, saveCache } from '../lib/cache'

export function useProjetMateriel(projetId) {
  const [data, setData] = useState({ version: null, blocks: [] })
  const [loading, setLoading] = useState(true)
  const cacheKey = `materiel:${projetId}`

  useEffect(() => {
    let alive = true
    loadCache(cacheKey).then((c) => {
      if (alive && c) {
        setData(c)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [cacheKey])

  const fetchMateriel = useCallback(async () => {
    if (!projetId) {
      setData({ version: null, blocks: [] })
      setLoading(false)
      return
    }
    try {
      // 1. MATOS-LISTES : listes du projet + version active de CHAQUE liste.
      //    Une seule liste → comportement historique ; plusieurs → les blocs
      //    de toutes les listes, préfixés du nom de la liste.
      const [{ data: listes }, { data: versions, error: vErr }] = await Promise.all([
        supabase
          .from('matos_listes')
          .select('id, titre, archived, sort_order, created_at')
          .eq('project_id', projetId)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('matos_versions')
          .select('id, numero, label, is_active, matos_liste_id')
          .eq('project_id', projetId)
          .is('archived_at', null)
          .order('numero', { ascending: false }),
      ])
      if (vErr) throw vErr

      const actives = (listes ?? [])
        .filter((l) => !l.archived)
        .map((liste) => {
          const ofListe = (versions ?? []).filter((v) => v.matos_liste_id === liste.id)
          const v = ofListe.find((x) => x.is_active) ?? ofListe[0] ?? null
          return v ? { liste, v } : null
        })
        .filter(Boolean)

      if (!actives.length) {
        const payload = { version: null, blocks: [] }
        setData(payload)
        saveCache(cacheKey, payload)
        return
      }
      const multi = actives.length > 1
      const version = multi
        ? { numero: null, label: `${actives.length} listes`, is_active: true }
        : {
            numero: actives[0].v.numero,
            label: actives[0].v.label,
            is_active: actives[0].v.is_active,
          }
      const listeByVersionId = new Map(actives.map(({ liste, v }) => [v.id, liste]))

      // 2. Blocs (de toutes les versions actives)
      const { data: blocksRaw } = await supabase
        .from('matos_blocks')
        .select('id, version_id, titre, couleur, affichage, sort_order')
        .in('version_id', actives.map(({ v }) => v.id))
        .order('sort_order', { ascending: true })
      // Ordre : les listes dans leur ordre, puis les blocs dans le leur.
      const listeOrder = new Map(actives.map(({ v }, i) => [v.id, i]))
      const blocks = (blocksRaw ?? [])
        .slice()
        .sort((a, b) => (listeOrder.get(a.version_id) ?? 0) - (listeOrder.get(b.version_id) ?? 0) || a.sort_order - b.sort_order)
        .map((b) => ({
          ...b,
          titre: multi ? `${listeByVersionId.get(b.version_id)?.titre} — ${b.titre}` : b.titre,
        }))
      const blockIds = (blocks ?? []).map((b) => b.id)

      // 3. Items + loueurs en parallèle
      const { data: items } = blockIds.length
        ? await supabase
            .from('matos_items')
            .select('id, block_id, label, designation, quantite, remarques, flag, sort_order')
            .in('block_id', blockIds)
            .is('removed_at', null)
            .order('sort_order', { ascending: true })
        : { data: [] }
      const itemIds = (items ?? []).map((i) => i.id)

      const { data: itemLoueurs } = itemIds.length
        ? await supabase
            .from('matos_item_loueurs')
            .select('item_id, loueur_id, numero_reference')
            .in('item_id', itemIds)
        : { data: [] }
      const loueurIds = [...new Set((itemLoueurs ?? []).map((l) => l.loueur_id))]
      const { data: loueurs } = loueurIds.length
        ? await supabase.from('fournisseurs').select('id, nom, couleur').in('id', loueurIds)
        : { data: [] }
      const loueurById = new Map((loueurs ?? []).map((l) => [l.id, l]))

      // Loueurs groupés par item
      const loueursByItem = new Map()
      for (const il of itemLoueurs ?? []) {
        const f = loueurById.get(il.loueur_id)
        if (!loueursByItem.has(il.item_id)) loueursByItem.set(il.item_id, [])
        loueursByItem.get(il.item_id).push({
          nom: f?.nom ?? 'Loueur',
          couleur: f?.couleur ? `#${String(f.couleur).replace('#', '')}` : null,
          ref: il.numero_reference || null,
        })
      }

      // Items groupés par bloc
      const itemsByBlock = new Map()
      for (const it of items ?? []) {
        const norm = {
          id: it.id,
          label: it.label || null,
          designation: it.designation,
          quantite: it.quantite ?? 1,
          remarques: it.remarques || null,
          flag: it.flag || 'ok',
          loueurs: loueursByItem.get(it.id) ?? [],
        }
        if (!itemsByBlock.has(it.block_id)) itemsByBlock.set(it.block_id, [])
        itemsByBlock.get(it.block_id).push(norm)
      }

      const blocksOut = (blocks ?? []).map((b) => ({
        id: b.id,
        titre: b.titre,
        couleur: b.couleur ? `#${String(b.couleur).replace('#', '')}` : null,
        items: itemsByBlock.get(b.id) ?? [],
      }))

      const payload = { version, blocks: blocksOut }
      setData(payload)
      saveCache(cacheKey, payload)
    } catch (err) {
      console.warn('[useProjetMateriel] error', err.message)
    } finally {
      setLoading(false)
    }
  }, [projetId])

  useEffect(() => {
    fetchMateriel()
  }, [fetchMateriel])

  return { version: data.version, blocks: data.blocks, loading, refetch: fetchMateriel }
}

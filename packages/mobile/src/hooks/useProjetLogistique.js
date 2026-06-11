// ════════════════════════════════════════════════════════════════════════════
// useProjetLogistique — logistique V0 d'un projet (général + entries par membre)
// ════════════════════════════════════════════════════════════════════════════
//
// Tables : projet_logistique_v0_global (bloc général) + projet_logistique_v0_entries
// (1 par membre : transport / hébergement / repas). Le filtrage "externe ne voit
// que ses infos" est appliqué côté écran (la RLS est tout-ou-rien par projet).
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { loadCache, saveCache } from '../lib/cache'

export function useProjetLogistique(projetId) {
  const { user } = useAuth()
  const [data, setData] = useState({ general: null, generalDocs: [], entries: [] })
  const [loading, setLoading] = useState(true)
  const cacheKey = `logistique:${projetId}`

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

  const fetchLogistique = useCallback(async () => {
    if (!projetId) {
      setData({ general: null, generalDocs: [], entries: [] })
      setLoading(false)
      return
    }
    try {
      const [globalRes, entriesRes] = await Promise.all([
        supabase
          .from('projet_logistique_v0_global')
          .select('id, text')
          .eq('project_id', projetId)
          .maybeSingle(),
        supabase
          .from('projet_logistique_v0_entries')
          .select(`
            id, membre_id, transport_text, hebergement_text, repas_text,
            projet_membres ( nom, prenom, specialite, contacts ( user_id, nom, prenom ) )
          `)
          .eq('project_id', projetId),
      ])

      if (entriesRes.error) throw entriesRes.error

      const entryRows = entriesRes.data ?? []
      const entryIds = entryRows.map((e) => e.id)
      const globalId = globalRes.data?.id ?? null

      // Documents (billets, réservations…)
      const [docsRes, gdocsRes] = await Promise.all([
        entryIds.length
          ? supabase
              .from('projet_logistique_v0_documents')
              .select('entry_id, kind, storage_path, filename, size_bytes, mime_type')
              .in('entry_id', entryIds)
          : Promise.resolve({ data: [] }),
        globalId
          ? supabase
              .from('projet_logistique_v0_global_documents')
              .select('storage_path, filename, size_bytes, mime_type')
              .eq('global_id', globalId)
          : Promise.resolve({ data: [] }),
      ])

      const mapDoc = (d) => ({ path: d.storage_path, name: d.filename, size: d.size_bytes, mime: d.mime_type })
      const docsByEntry = new Map()
      for (const d of docsRes.data ?? []) {
        if (!docsByEntry.has(d.entry_id)) docsByEntry.set(d.entry_id, { transport: [], hebergement: [], repas: [] })
        const bucket = docsByEntry.get(d.entry_id)
        ;(bucket[d.kind] ?? (bucket[d.kind] = [])).push(mapDoc(d))
      }

      const entries = entryRows.map((e) => {
        const pm = e.projet_membres
        const ct = pm?.contacts
        const prenom = ct?.prenom ?? pm?.prenom
        const nom = ct?.nom ?? pm?.nom
        return {
          id: e.id,
          membre_id: e.membre_id,
          nom: [prenom, nom].filter(Boolean).join(' ').trim() || 'Membre',
          poste: pm?.specialite ?? null,
          transport: e.transport_text || null,
          hebergement: e.hebergement_text || null,
          repas: e.repas_text || null,
          docs: docsByEntry.get(e.id) ?? { transport: [], hebergement: [], repas: [] },
          is_me: !!ct?.user_id && ct.user_id === user?.id,
        }
      })

      const payload = {
        general: globalRes.data?.text ?? null,
        generalDocs: (gdocsRes.data ?? []).map(mapDoc),
        entries,
      }
      setData(payload)
      saveCache(cacheKey, payload)
    } catch (err) {
      console.warn('[useProjetLogistique] error', err.message)
    } finally {
      setLoading(false)
    }
  }, [projetId, user?.id])

  useEffect(() => {
    fetchLogistique()
  }, [fetchLogistique])

  const myEntry = useMemo(() => data.entries.find((e) => e.is_me) ?? null, [data.entries])
  const otherEntries = useMemo(() => data.entries.filter((e) => !e.is_me), [data.entries])

  return {
    general: data.general,
    generalDocs: data.generalDocs ?? [],
    entries: data.entries,
    myEntry,
    otherEntries,
    loading,
    refetch: fetchLogistique,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// useLogistiqueV0 — Hook React pour l'outil Logistique V0 (provisoire)
// ════════════════════════════════════════════════════════════════════════════
//
// Charge en parallèle :
//   - les entries (1 par membre logé)
//   - les documents (tous, à travers tous les entries du projet)
//
// Expose des actions qui font la mise à jour DB + mise à jour locale optimiste
// (pas de reload complet après chaque action — UI fluide).
//
// Pattern aligné sur useCrew / useLivrables : single source of truth dans le
// state local, actions = call lib + setState.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  listEntries as libListEntries,
  addEntry as libAddEntry,
  removeEntry as libRemoveEntry,
  updateEntryText as libUpdateEntryText,
  setEntryHiddenKinds as libSetEntryHiddenKinds,
  uploadDocument as libUploadDocument,
  deleteDocument as libDeleteDocument,
} from '../lib/logistiqueV0'

export function useLogistiqueV0(projectId) {
  const [entries, setEntries] = useState([])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!projectId) {
      setEntries([])
      setDocuments([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const ents = await libListEntries(projectId)
      setEntries(ents)

      // Fetch all documents for these entries in one query. On utilise un
      // IN sur entry_id plutôt qu'une jointure inverse pour ne pas alourdir
      // la requête entries (qui peut être appelée seule ailleurs).
      if (ents.length === 0) {
        setDocuments([])
      } else {
        const entryIds = ents.map((e) => e.id)
        const { data, error: docsError } = await supabase
          .from('projet_logistique_v0_documents')
          .select(
            'id, entry_id, kind, storage_path, filename, mime_type, size_bytes, uploaded_by_name, created_at',
          )
          .in('entry_id', entryIds)
          .order('created_at', { ascending: true })
        if (docsError) throw docsError
        setDocuments(data || [])
      }
    } catch (err) {
      setError(err)
       
      console.error('[useLogistiqueV0] reload error :', err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    reload()
  }, [reload])

  // ─── Actions (optimistic state updates) ────────────────────────────────
  const actions = useMemo(
    () => ({
      addEntry: async ({ membreId }) => {
        const newEntry = await libAddEntry({ projectId, membreId })
        setEntries((prev) => [...prev, newEntry])
        return newEntry
      },

      removeEntry: async (entryId) => {
        await libRemoveEntry(entryId)
        setEntries((prev) => prev.filter((e) => e.id !== entryId))
        setDocuments((prev) => prev.filter((d) => d.entry_id !== entryId))
      },

      updateEntryText: async (entryId, kind, text) => {
        const updated = await libUpdateEntryText(entryId, kind, text)
        setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)))
        return updated
      },

      setEntryHiddenKinds: async (entryId, hiddenKinds) => {
        const updated = await libSetEntryHiddenKinds(entryId, hiddenKinds)
        setEntries((prev) => prev.map((e) => (e.id === entryId ? updated : e)))
        return updated
      },

      uploadDocument: async ({ entryId, kind, file, uploadedByName }) => {
        const newDoc = await libUploadDocument({ entryId, kind, file, uploadedByName })
        setDocuments((prev) => [...prev, newDoc])
        return newDoc
      },

      deleteDocument: async (documentId) => {
        await libDeleteDocument(documentId)
        setDocuments((prev) => prev.filter((d) => d.id !== documentId))
      },
    }),
    [projectId],
  )

  // ─── Helpers de groupage (utilisés par l'UI) ───────────────────────────
  // documentsByEntry : Map<entry_id, Map<kind, Array<document>>>
  // → permet à la card d'une personne de récupérer rapidement les docs
  //   d'un sous-bloc précis.
  const documentsByEntry = useMemo(() => {
    const map = new Map()
    for (const doc of documents) {
      if (!map.has(doc.entry_id)) {
        map.set(doc.entry_id, new Map())
      }
      const byKind = map.get(doc.entry_id)
      if (!byKind.has(doc.kind)) byKind.set(doc.kind, [])
      byKind.get(doc.kind).push(doc)
    }
    return map
  }, [documents])

  return {
    entries,
    documents,
    documentsByEntry,
    loading,
    error,
    reload,
    ...actions,
  }
}

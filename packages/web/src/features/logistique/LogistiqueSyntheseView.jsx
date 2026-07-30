// ════════════════════════════════════════════════════════════════════════════
// LogistiqueSyntheseView — synthèse festival (Logistique V1, P3)
// ════════════════════════════════════════════════════════════════════════════
//
// La vision d'ensemble à envoyer à la prod du festival. Fetch + export PDF ;
// le RENDU des sections vit dans LogistiqueSyntheseSections (partagé avec la
// page publique token, P4). Lecture seule — tout s'édite dans la grille.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { fetchProjectSessions, listTechlistRows } from '../../lib/crew'
import { fetchLogistique } from '../../lib/logistique'
import { computeSynthese } from './logistiqueSynthese'
import LogistiqueSyntheseSections from './LogistiqueSyntheseSections'
import { notify } from '../../lib/notify'
import PdfPreviewModal from '../materiel/components/PdfPreviewModal'

export default function LogistiqueSyntheseView({ projectId, project = null, org = null, membres = [] }) {
  const [participations, setParticipations] = useState([])
  const [logi, setLogi] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [parts, l] = await Promise.all([
        fetchProjectSessions(projectId),
        fetchLogistique(projectId),
      ])
      setParticipations(parts)
      setLogi(l)
    } catch (err) {
      notify.error('Chargement synthèse : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const techRows = useMemo(() => listTechlistRows(membres), [membres])
  const synthese = useMemo(
    () => (logi ? computeSynthese({ techRows, participations, logi }) : null),
    [techRows, participations, logi],
  )

  async function handleExportPdf() {
    if (!synthese || exporting) return
    setExporting(true)
    try {
      const { exportLogistiqueSynthesePDF } = await import('./logistiquePdfExport')
      const result = await exportLogistiqueSynthesePDF({ project, org, synthese })
      setPreview({ ...result, title: 'Synthèse logistique' })
    } catch (err) {
      notify.error('Export PDF : ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  if (loading || !synthese) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--blue)' }} />
      </div>
    )
  }

  const empty =
    synthese.repasParJour.length === 0 &&
    synthese.hebs.length === 0 &&
    synthese.mouvements.length === 0

  return (
    <div className="px-1 pb-8 flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
          Chiffres calculés depuis la grille — repas Client = à commander au festival.
        </p>
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={exporting || empty}
          className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md disabled:opacity-40"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
          Exporter PDF
        </button>
      </div>

      {empty ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--bg-surf)', border: '1px dashed var(--brd)' }}
        >
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            Rien à synthétiser — remplis la grille (repas, nuits, trajets).
          </p>
        </div>
      ) : (
        <LogistiqueSyntheseSections synthese={synthese} />
      )}

      <PdfPreviewModal
        open={Boolean(preview)}
        onClose={() => {
          preview?.revoke?.()
          setPreview(null)
        }}
        title={preview?.title}
        url={preview?.url}
        filename={preview?.filename}
        onDownload={() => preview?.download?.()}
      />
    </div>
  )
}

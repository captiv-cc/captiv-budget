// ════════════════════════════════════════════════════════════════════════════
// AudioDropZone — dépôt groupé des fichiers de travail
// ════════════════════════════════════════════════════════════════════════════
//
// Déposer cent morceaux un par un serait décourageant : on accepte un lot,
// on rattache chaque fichier à sa proposition par son nom, et on ne demande
// à l'utilisateur que ce qui n'a pas pu l'être.
//
// Les fichiers sont traités un par un : décoder plusieurs MP3 en parallèle
// sature la mémoire (une minute de PCM pèse une vingtaine de mégaoctets).
// ════════════════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react'
import { AudioLines, Check, Loader2, Upload, X } from 'lucide-react'
import {
  AUDIO_ACCEPT,
  matchFileToProposition,
  uploadPropositionAudio,
} from '../../lib/musiqueAudio'
import { notify } from '../../lib/notify'

export default function AudioDropZone({
  projectId,
  propositions = [],
  userId = null,
  onUploaded, // (proposition) => void
}) {
  const [over, setOver] = useState(false)
  const [queue, setQueue] = useState([]) // [{ name, statut, cible }]
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.size > 0)
    if (files.length === 0) return

    // On prépare tout le lot AVANT d'envoyer, pour afficher d'emblée ce qui
    // partira et ce qui restera à rattacher à la main.
    const plan = files.map((file) => {
      const { proposition, ambigu } = matchFileToProposition(file.name, propositions)
      return {
        file,
        name: file.name,
        cible: proposition,
        statut: proposition ? 'attente' : ambigu ? 'ambigu' : 'inconnu',
      }
    })
    setQueue(plan)

    const aEnvoyer = plan.filter((item) => item.cible)
    if (aEnvoyer.length === 0) {
      notify.error('Aucun fichier reconnu — renomme en « Artiste - Titre.mp3 »')
      return
    }

    setBusy(true)
    for (const item of aEnvoyer) {
      setQueue((prev) =>
        prev.map((x) => (x.name === item.name ? { ...x, statut: 'encours' } : x)),
      )
      try {
        const updated = await uploadPropositionAudio({
          projectId,
          proposition: item.cible,
          file: item.file,
          userId,
        })
        onUploaded?.(updated)
        setQueue((prev) =>
          prev.map((x) => (x.name === item.name ? { ...x, statut: 'ok' } : x)),
        )
      } catch (err) {
        notify.error(`${item.name} : ${err?.message || err}`)
        setQueue((prev) =>
          prev.map((x) => (x.name === item.name ? { ...x, statut: 'erreur' } : x)),
        )
      }
    }
    setBusy(false)
  }

  const restants = queue.filter((q) => q.statut === 'inconnu' || q.statut === 'ambigu')

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          handleFiles(e.dataTransfer?.files)
        }}
        onClick={() => inputRef.current?.click()}
        className="rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors"
        style={{
          background: over ? 'var(--blue-bg)' : 'var(--bg-surf)',
          border: `1px dashed ${over ? 'var(--blue)' : 'var(--brd)'}`,
        }}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--blue)' }} />
        ) : (
          <AudioLines className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>
            Déposer les fichiers audio de travail
          </p>
          <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            Nommés « Artiste - Titre.mp3 », ils se rattachent tout seuls. Nécessaires
            pour couper et enchaîner les morceaux dans un berceau.
          </p>
        </div>
        <Upload className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color: 'var(--txt-3)' }} />
        <input
          ref={inputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {queue.length > 0 && (
        <div
          className="rounded-lg px-3 py-2 flex flex-col gap-1"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
        >
          {queue.map((item) => (
            <div key={item.name} className="flex items-center gap-2 text-[11px]">
              <StatutIcon statut={item.statut} />
              <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--txt-2)' }}>
                {item.name}
              </span>
              <span className="shrink-0" style={{ color: 'var(--txt-3)' }}>
                {item.cible
                  ? item.cible.titre
                  : item.statut === 'ambigu'
                    ? 'plusieurs correspondances'
                    : 'non reconnu'}
              </span>
            </div>
          ))}
          {restants.length > 0 && !busy && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
              {restants.length} fichier{restants.length > 1 ? 's' : ''} à rattacher depuis la
              ligne du morceau.
            </p>
          )}
          {!busy && (
            <button
              type="button"
              onClick={() => setQueue([])}
              className="text-[10px] font-semibold self-end"
              style={{ color: 'var(--blue)' }}
            >
              Effacer le rapport
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StatutIcon({ statut }) {
  if (statut === 'ok') return <Check className="w-3 h-3 shrink-0" style={{ color: '#22c55e' }} />
  if (statut === 'encours')
    return <Loader2 className="w-3 h-3 shrink-0 animate-spin" style={{ color: 'var(--blue)' }} />
  if (statut === 'erreur' || statut === 'ambigu' || statut === 'inconnu')
    return <X className="w-3 h-3 shrink-0" style={{ color: 'var(--amber, #f59e0b)' }} />
  return <span className="w-3 h-3 shrink-0" />
}

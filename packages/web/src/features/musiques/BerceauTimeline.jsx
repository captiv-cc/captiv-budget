// ════════════════════════════════════════════════════════════════════════════
// BerceauTimeline — la bande de montage
// ════════════════════════════════════════════════════════════════════════════
//
// Une liste verticale ne montre pas ce qu'est un berceau. Ici les blocs
// occupent une largeur proportionnelle à leur durée, sur une bande unique :
// on voit d'un coup où on en est de la cible, quel morceau tient la moitié
// du film, et où couper.
//
// Trim aux bords du bloc, déplacement en glissant depuis son centre, curseur
// de lecture, et une règle cliquable pour se positionner.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatMs, slicePeaks } from '../../lib/musiqueAudio'
import { clampCoupe, dureeExploitableMs } from '../../lib/musiqueBerceaux'
import WaveformMini from './WaveformMini'

export default function BerceauTimeline({
  positions, // [{ bloc, start_ms, end_ms, duree_ms }]
  propById,
  pxParSeconde,
  cibleMs,
  positionMs,
  activeBlocId,
  selectedId,
  canEdit,
  onSelect,
  onSeek,
  onTrim, // (bloc, { in_ms, out_ms }) => void
  onReorder, // (blocsOrdonnes) => void
}) {
  const bandeRef = useRef(null)
  const [drag, setDrag] = useState(null) // { blocId, mode, startX, in_ms, out_ms }
  const [dragOverId, setDragOverId] = useState(null)

  const totalMs = positions.length ? positions[positions.length - 1].end_ms : 0
  const largeurMs = Math.max(totalMs, cibleMs || 0, 30000)
  const msToPx = (ms) => (ms / 1000) * pxParSeconde

  // Graduations : une toutes les 30 s tant que ça reste lisible.
  const graduations = useMemo(() => {
    const pas = pxParSeconde >= 6 ? 30000 : 60000
    const out = []
    for (let ms = 0; ms <= largeurMs; ms += pas) out.push(ms)
    return out
  }, [largeurMs, pxParSeconde])

  useEffect(() => {
    if (!drag || !canEdit) return undefined
    function onMove(e) {
      const deltaMs = ((e.clientX - drag.startX) / pxParSeconde) * 1000
      const item = positions.find((p) => p.bloc.id === drag.blocId)
      if (!item) return
      const max = dureeExploitableMs(propById.get(item.bloc.proposition_id))
      const next =
        drag.mode === 'in'
          ? { in_ms: drag.in_ms + deltaMs, out_ms: drag.out_ms }
          : { in_ms: drag.in_ms, out_ms: drag.out_ms + deltaMs }
      onTrim(item.bloc, clampCoupe(next, max))
    }
    function onUp() {
      setDrag(null)
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
  }, [drag, canEdit, pxParSeconde, positions, propById, onTrim])

  function handleReorderDrop(cibleId, sourceId) {
    if (!sourceId || sourceId === cibleId) return
    const ordered = positions.map((p) => p.bloc)
    const from = ordered.findIndex((b) => b.id === sourceId)
    const to = ordered.findIndex((b) => b.id === cibleId)
    if (from < 0 || to < 0) return
    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onReorder(next)
  }

  return (
    <div className="flex flex-col">
      {/* Règle : clic pour se positionner */}
      <div
        className="relative select-none"
        style={{ height: 22, cursor: 'pointer' }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          onSeek(((e.clientX - rect.left) / pxParSeconde) * 1000)
        }}
      >
        <div style={{ width: msToPx(largeurMs), position: 'relative', height: '100%' }}>
          {graduations.map((ms) => (
            <span
              key={ms}
              className="absolute top-0 text-[9px] tabular-nums"
              style={{ left: msToPx(ms), color: 'var(--txt-3)', paddingLeft: 2 }}
            >
              <span
                className="absolute top-3 left-0"
                style={{ width: 1, height: 6, background: 'var(--brd)' }}
              />
              {formatMs(ms)}
            </span>
          ))}
          {/* Repère de la durée visée : le berceau doit tomber dessus. */}
          {cibleMs > 0 && (
            <span
              className="absolute top-0 bottom-0"
              style={{ left: msToPx(cibleMs), width: 2, background: 'var(--amber, #f59e0b)' }}
              title={`Cible ${formatMs(cibleMs)}`}
            />
          )}
        </div>
      </div>

      {/* Bande des blocs */}
      <div
        ref={bandeRef}
        className="relative rounded-lg"
        style={{
          height: 86,
          width: Math.max(msToPx(largeurMs), 1),
          background: 'var(--bg)',
          border: '1px solid var(--brd-sub)',
        }}
      >
        {positions.map(({ bloc, start_ms, duree_ms }) => {
          const prop = propById.get(bloc.proposition_id)
          const largeur = Math.max(24, msToPx(duree_ms))
          const actif = activeBlocId === bloc.id
          const choisi = selectedId === bloc.id
          const dureeTotale = dureeExploitableMs(prop)
          return (
            <div
              key={bloc.id}
              draggable={canEdit && !drag}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', bloc.id)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverId(bloc.id)
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverId(null)
                handleReorderDrop(bloc.id, e.dataTransfer.getData('text/plain'))
              }}
              onClick={() => onSelect(bloc.id)}
              className="absolute top-1 bottom-1 rounded-md overflow-hidden"
              style={{
                left: msToPx(start_ms),
                width: largeur,
                background: actif ? 'rgba(167,139,250,0.22)' : 'var(--bg-surf)',
                border: `1px solid ${
                  dragOverId === bloc.id
                    ? 'var(--blue)'
                    : choisi
                      ? 'var(--purple, #a78bfa)'
                      : 'var(--brd-sub)'
                }`,
                cursor: canEdit ? 'grab' : 'pointer',
              }}
              title={`${prop?.titre || ''} · ${formatMs(duree_ms)}`}
            >
              {/* Forme d'onde de la PORTION retenue, pas du morceau entier */}
              <div className="absolute inset-0 flex items-center px-0.5 pointer-events-none opacity-70">
                <WaveformMini
                  peaks={slicePeaks(prop?.audio_peaks, bloc.in_ms, bloc.out_ms, dureeTotale)}
                  width={Math.max(20, largeur - 4)}
                  height={56}
                />
              </div>

              {/* Sous une certaine largeur, le texte devient illisible et
                  masque la forme d'onde : on le retire par paliers plutôt
                  que de le laisser baver. L'infobulle garde l'information. */}
              {largeur > 44 && (
                <div
                  className="relative p-1.5 pointer-events-none"
                  style={{
                    // Fond localisé sous le texte : lisible par-dessus la
                    // forme d'onde sans assombrir tout le bloc.
                    background:
                      'linear-gradient(to right, var(--bg-surf) 0%, rgba(0,0,0,0) 100%)',
                    width: 'min(100%, 150px)',
                  }}
                >
                  <p className="text-[10px] font-bold truncate" style={{ color: 'var(--txt)' }}>
                    {prop?.titre || 'Morceau supprimé'}
                  </p>
                  {largeur > 90 && (
                    <p className="text-[9px] truncate" style={{ color: 'var(--txt-2)' }}>
                      {prop?.artiste_text || prop?.artiste?.nom || ''}
                    </p>
                  )}
                  {largeur > 70 && (
                    <p className="text-[9px] tabular-nums" style={{ color: 'var(--txt-3)' }}>
                      {formatMs(duree_ms)}
                    </p>
                  )}
                </div>
              )}

              {canEdit && (
                <>
                  <PoigneeTrim
                    cote="left"
                    onDown={(e) =>
                      setDrag({
                        blocId: bloc.id,
                        mode: 'in',
                        startX: e.clientX,
                        in_ms: bloc.in_ms,
                        out_ms: bloc.out_ms,
                      })
                    }
                  />
                  <PoigneeTrim
                    cote="right"
                    onDown={(e) =>
                      setDrag({
                        blocId: bloc.id,
                        mode: 'out',
                        startX: e.clientX,
                        in_ms: bloc.in_ms,
                        out_ms: bloc.out_ms,
                      })
                    }
                  />
                </>
              )}
            </div>
          )
        })}

        {/* Curseur de lecture */}
        {positionMs > 0 && (
          <span
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: msToPx(positionMs), width: 2, background: 'var(--blue)' }}
          />
        )}

        {positions.length === 0 && (
          <p
            className="absolute inset-0 flex items-center justify-center text-xs"
            style={{ color: 'var(--txt-3)' }}
          >
            Ajoute un morceau depuis la colonne de gauche.
          </p>
        )}
      </div>
    </div>
  )
}

function PoigneeTrim({ cote, onDown }) {
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDown(e)
      }}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 bottom-0"
      style={{
        [cote]: 0,
        width: 7,
        cursor: 'col-resize',
        background:
          cote === 'left'
            ? 'linear-gradient(to right, var(--purple, #a78bfa) 0 2px, transparent 2px)'
            : 'linear-gradient(to left, var(--purple, #a78bfa) 0 2px, transparent 2px)',
        opacity: 0.6,
      }}
      title="Glisser pour recouper"
    />
  )
}

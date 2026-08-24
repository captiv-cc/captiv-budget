// ════════════════════════════════════════════════════════════════════════════
// BerceauEditor — montage d'un enchaînement musical
// ════════════════════════════════════════════════════════════════════════════
//
// À gauche les morceaux disponibles, à droite la timeline : des blocs qui
// s'enchaînent bout à bout, réordonnables au glisser-déposer, chacun coupé
// sur sa forme d'onde.
//
// Un bloc sans fichier déposé porte sur l'extrait 30 s. C'est signalé
// explicitement : on ne construit pas un berceau de quatre minutes avec des
// extraits, mais on teste très bien un ordre d'enchaînement.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Plus, Search, Trash2 } from 'lucide-react'
import {
  blocSource,
  ecartCibleMs,
  timelineDureeMs,
  timelinePositions,
} from '../../lib/musiqueBerceaux'
import { formatMs } from '../../lib/musiqueAudio'
import BerceauTimeline from './BerceauTimeline'
import BlocInspector from './BlocInspector'
import useBerceauPlayer from './useBerceauPlayer'

export default function BerceauEditor({
  berceau,
  blocs = [],
  propositions = [],
  links = [],
  aggregates = null, // Map<id, { noteAvg, noteCount }>
  canEdit = true,
  onAddBloc,
  onUpdateBloc,
  onDeleteBloc,
  onReorder,
}) {
  const [selectedId, setSelectedId] = useState(null)
  // Un berceau se monte à partir des musiques déjà attribuées au livrable ;
  // le vrac complet reste accessible d'un cran, pour aller y piocher.
  const [sourceListe, setSourceListe] = useState('livrable')
  // Échelle de la bande. Ajustée à la largeur réelle plutôt qu'à une
  // constante : sur un écran donné, le berceau doit tenir en entier avant
  // qu'on décide de zoomer.
  const [pxParSeconde, setPxParSeconde] = useState(8)
  const [autoZoom, setAutoZoom] = useState(true)
  const bandeWrapRef = useRef(null)
  const [query, setQuery] = useState('')
  const [tri, setTri] = useState('defaut')
  // Monter pour de vrai suppose des fichiers : ce filtre isole ce sur quoi
  // on peut réellement couper.
  const [avecFichier, setAvecFichier] = useState(false)

  // Changer de livrable doit reproposer SES musiques : garder « tout le
  // vrac » d'un livrable à l'autre n'a pas de sens.
  useEffect(() => {
    setSourceListe('livrable')
  }, [berceau?.livrable_id])

  const propById = useMemo(
    () => new Map(propositions.map((p) => [p.id, p])),
    [propositions],
  )

  // Propositions attribuées au livrable du berceau (tous statuts : une piste
  // encore au stade de proposition a toute sa place dans une maquette).
  const propsDuLivrable = useMemo(() => {
    if (!berceau?.livrable_id) return []
    const ids = new Set(
      links
        .filter((l) => l.livrable_id === berceau.livrable_id)
        .map((l) => l.proposition_id),
    )
    return propositions.filter((p) => ids.has(p.id))
  }, [links, propositions, berceau?.livrable_id])

  const listeAffichee = useMemo(() => {
    const base =
      sourceListe === 'livrable' && berceau?.livrable_id ? propsDuLivrable : propositions
    const q = query.trim().toLowerCase()
    let out = base.filter((p) => {
      if (avecFichier && !p.audio_path) return false
      if (!q) return true
      const artiste = (p.artiste_text || p.artiste?.nom || '').toLowerCase()
      return `${p.titre} ${artiste}`.toLowerCase().includes(q)
    })
    if (tri === 'note') {
      out = [...out].sort(
        (a, b) => (aggregates?.get(b.id)?.noteAvg || 0) - (aggregates?.get(a.id)?.noteAvg || 0),
      )
    } else if (tri === 'titre') {
      out = [...out].sort((a, b) => a.titre.localeCompare(b.titre, 'fr', { sensitivity: 'base' }))
    } else if (tri === 'artiste') {
      out = [...out].sort((a, b) =>
        (a.artiste_text || a.artiste?.nom || '').localeCompare(
          b.artiste_text || b.artiste?.nom || '',
          'fr',
          { sensitivity: 'base' },
        ),
      )
    } else if (tri === 'bpm') {
      out = [...out].sort(
        (a, b) => (b.audio_features?.tempo || 0) - (a.audio_features?.tempo || 0),
      )
    }
    return out
  }, [
    sourceListe,
    berceau?.livrable_id,
    propsDuLivrable,
    propositions,
    query,
    avecFichier,
    tri,
    aggregates,
  ])
  const positions = useMemo(() => timelinePositions(blocs), [blocs])
  const total = timelineDureeMs(blocs)
  const ecart = ecartCibleMs(blocs, berceau?.duree_cible_ms)
  const selectedBloc = blocs.find((b) => b.id === selectedId) || null
  const player = useBerceauPlayer({ blocs, propById })

  // Tant que l'utilisateur n'a pas touché au zoom, on tient tout à l'écran.
  // Dès qu'il l'ajuste, on ne lui reprend plus la main.
  const ajusterZoom = useCallback(() => {
    const largeur = bandeWrapRef.current?.clientWidth || 0
    const etendueMs = Math.max(total, berceau?.duree_cible_ms || 0, 30000)
    if (!largeur || !etendueMs) return
    const px = (largeur - 8) / (etendueMs / 1000)
    setPxParSeconde(Math.min(30, Math.max(1, px)))
  }, [total, berceau?.duree_cible_ms])

  useEffect(() => {
    if (!autoZoom) return undefined
    ajusterZoom()
    const ro = new ResizeObserver(() => ajusterZoom())
    if (bandeWrapRef.current) ro.observe(bandeWrapRef.current)
    return () => ro.disconnect()
  }, [autoZoom, ajusterZoom])

  // Changer de berceau remet l'ajustement automatique : on veut d'abord
  // voir l'ensemble du nouveau montage.
  useEffect(() => {
    setAutoZoom(true)
    setSelectedId(null)
  }, [berceau?.id])

  // Morceaux pas encore posés : on ne masque pas ceux déjà utilisés (un
  // même titre peut revenir deux fois dans un berceau), on les signale.
  const posesCount = useMemo(() => {
    const m = new Map()
    for (const b of blocs) m.set(b.proposition_id, (m.get(b.proposition_id) || 0) + 1)
    return m
  }, [blocs])

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ── Morceaux disponibles ─────────────────────────────────────────── */}
      <aside
        className="lg:w-72 shrink-0 rounded-xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', maxHeight: 560 }}
      >
        <header
          className="px-3 py-2 shrink-0 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
            Morceaux
          </p>
          <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {listeAffichee.length}
          </span>
          {berceau?.livrable_id && (
            <select
              value={sourceListe}
              onChange={(e) => setSourceListe(e.target.value)}
              className="ml-auto text-[10px] px-1 py-0.5 rounded outline-none"
              style={{
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
                color: 'var(--txt-3)',
              }}
              title="Où piocher les morceaux"
            >
              <option value="livrable">Du livrable</option>
              <option value="vrac">Tout le vrac</option>
            </select>
          )}
        </header>
        <div
          className="px-2 py-1.5 shrink-0 flex flex-col gap-1.5"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div className="relative">
            <Search
              className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--txt-3)' }}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Titre ou artiste"
              className="w-full text-[11px] pl-7 pr-2 py-1.5 rounded-md outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd-sub)', color: 'var(--txt)' }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={tri}
              onChange={(e) => setTri(e.target.value)}
              className="flex-1 min-w-0 text-[10px] px-1 py-1 rounded outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd-sub)', color: 'var(--txt-3)' }}
            >
              <option value="defaut">Ordre du vrac</option>
              <option value="note">Mieux notées</option>
              <option value="titre">Titre</option>
              <option value="artiste">Artiste</option>
              <option value="bpm">BPM décroissant</option>
            </select>
            <button
              type="button"
              onClick={() => setAvecFichier((v) => !v)}
              className="text-[10px] font-semibold px-1.5 py-1 rounded shrink-0"
              style={{
                background: avecFichier ? 'var(--blue-bg)' : 'transparent',
                color: avecFichier ? 'var(--blue)' : 'var(--txt-3)',
                border: `1px solid ${avecFichier ? 'var(--blue)' : 'var(--brd-sub)'}`,
              }}
              title="N'afficher que les morceaux dont le fichier est déposé"
            >
              fichier
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
          {listeAffichee.length === 0 && (
            <p className="text-[11px] italic p-2" style={{ color: 'var(--txt-3)' }}>
              {berceau?.livrable_id && sourceListe === 'livrable'
                ? 'Aucune musique attribuée à ce livrable — bascule sur « Tout le vrac ».'
                : 'Aucune proposition sur ce projet.'}
            </p>
          )}
          {listeAffichee.map((p) => {
            const source = blocSource(p)
            const dejaPose = posesCount.get(p.id) || 0
            return (
              <button
                key={p.id}
                type="button"
                disabled={!canEdit || source === 'aucune'}
                onClick={() => onAddBloc?.(p)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left disabled:opacity-40"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
                title={
                  source === 'aucune'
                    ? 'Ni fichier déposé ni extrait — rien à jouer'
                    : 'Ajouter à la fin du berceau'
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--txt)' }}>
                    {p.titre}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                    {[
                      p.artiste_text || p.artiste?.nom || '—',
                      aggregates?.get(p.id)?.noteAvg
                        ? `★ ${Math.round(aggregates.get(p.id).noteAvg * 10) / 10}`
                        : null,
                      p.audio_features?.tempo > 0
                        ? `${Math.round(p.audio_features.tempo)} bpm`
                        : null,
                      dejaPose > 0 ? `posé ${dejaPose}×` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <SourceBadge source={source} />
                {canEdit && source !== 'aucune' && (
                  <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                )}
              </button>
            )
          })}
        </div>
      </aside>

      {/* ── Montage ──────────────────────────────────────────────────────── */}
      <section className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Transport + compteurs */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={player.toggle}
            disabled={blocs.length === 0}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            {player.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {player.playing ? 'Pause' : 'Lire le berceau'}
          </button>

          <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--txt)' }}>
            {formatMs(player.positionMs > 0 ? player.positionMs : total)}
          </span>
          {berceau?.duree_cible_ms ? (
            <span
              className="text-xs font-semibold"
              style={{
                color:
                  Math.abs(ecart) < 3000
                    ? '#22c55e'
                    : ecart < 0
                      ? 'var(--txt-3)'
                      : 'var(--amber, #f59e0b)',
              }}
            >
              {formatMs(total)} / {formatMs(berceau.duree_cible_ms)} ·{' '}
              {ecart === 0
                ? 'pile'
                : ecart < 0
                  ? `il manque ${formatMs(-ecart)}`
                  : `${formatMs(ecart)} de trop`}
            </span>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {formatMs(total)} · aucune durée cible
            </span>
          )}

          {/* Zoom : un aftermovie de 4 min doit tenir à l'écran, une coupe
              de 3 s doit rester attrapable. */}
          <label className="flex items-center gap-1.5 ml-auto text-[10px]" style={{ color: 'var(--txt-3)' }}>
            zoom
            <input
              type="range"
              min={1}
              max={40}
              step={1}
              value={Math.round(pxParSeconde)}
              onChange={(e) => {
                setAutoZoom(false)
                setPxParSeconde(Number(e.target.value))
              }}
              className="w-24"
            />
          </label>
          {!autoZoom && (
            <button
              type="button"
              onClick={() => setAutoZoom(true)}
              className="text-[10px] font-semibold px-1.5 py-1 rounded"
              style={{ color: 'var(--blue)', border: '1px solid var(--brd-sub)' }}
              title="Faire tenir tout le berceau à l'écran"
            >
              ajuster
            </button>
          )}
          <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {blocs.length} bloc{blocs.length > 1 ? 's' : ''}
          </span>
        </div>

        {/* La bande */}
        <div ref={bandeWrapRef} className="overflow-x-auto pb-1 min-w-0 max-w-full">
          <BerceauTimeline
            positions={positions}
            propById={propById}
            pxParSeconde={pxParSeconde}
            cibleMs={berceau?.duree_cible_ms || 0}
            positionMs={player.positionMs}
            activeBlocId={player.activeBlocId}
            selectedId={selectedId}
            canEdit={canEdit}
            onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
            onSeek={player.seek}
            onTrim={(bloc, patch) => onUpdateBloc?.(bloc, patch)}
            onReorder={(ordered) => onReorder?.(ordered)}
          />
        </div>

        {/* Recoupage fin du bloc choisi */}
        {selectedBloc ? (
          <BlocInspector
            bloc={selectedBloc}
            proposition={propById.get(selectedBloc.proposition_id)}
            canEdit={canEdit}
            onUpdate={(patch) => onUpdateBloc?.(selectedBloc, patch)}
          />
        ) : (
          blocs.length > 0 && (
            <p className="text-[11px] text-center py-3" style={{ color: 'var(--txt-3)' }}>
              Clique un bloc pour le recouper précisément.
            </p>
          )
        )}

        {selectedBloc && canEdit && (
          <button
            type="button"
            onClick={() => {
              onDeleteBloc?.(selectedBloc)
              setSelectedId(null)
            }}
            className="self-start flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md"
            style={{ color: 'var(--red, #ef4444)', border: '1px solid var(--brd-sub)' }}
          >
            <Trash2 className="w-3 h-3" />
            Retirer ce bloc
          </button>
        )}
      </section>
    </div>
  )
}

function SourceBadge({ source }) {
  if (source === 'fichier') return null
  const label = source === 'extrait' ? '30 s' : 'aucun'
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{
        background: 'rgba(245,158,11,0.14)',
        color: 'var(--amber, #f59e0b)',
      }}
      title={
        source === 'extrait'
          ? 'Pas de fichier déposé : seul l’extrait de 30 s est jouable'
          : 'Ni fichier ni extrait'
      }
    >
      {label}
    </span>
  )
}

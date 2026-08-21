// ════════════════════════════════════════════════════════════════════════════
// ContenusTab — validation des photos / vidéos par l'équipe presse
// ════════════════════════════════════════════════════════════════════════════
//
// Vue interne du module Contenus. Le même tableau est servi aux externes par
// les liens de partage (lecture pour les photographes, écriture derrière mot
// de passe pour l'équipe du festival).
//
// Cf. supabase/migrations/20260821a_contenus.sql.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Images, Loader2, Lock, Plus } from 'lucide-react'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  CONTENU_TYPES,
  CONTENU_TYPE_LABELS,
  addContenuEvent,
  createContenu,
  createContenuRef,
  deleteContenu,
  listContenuEvents,
  listContenuRefs,
  listContenus,
  listProjetArtistes,
  listProjetJours,
  resolveSujet,
  refValues,
  updateContenu,
} from '../../lib/contenus'
import { supabase } from '../../lib/supabase'
import ContenusTable from '../../features/contenus/ContenusTable'
import RefSelect from '../../features/contenus/RefSelect'
import JourSelect from '../../features/contenus/JourSelect'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

const OUTIL_KEY = 'contenus'

export default function ContenusTab() {
  const { id: projectId } = useParams()
  const outletCtx = useOutletContext?.() || {}
  const project = outletCtx.project || null
  const { can } = useProjectPermissions(projectId)
  const { profile } = useAuth()
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')

  const [contenus, setContenus] = useState([])
  const [events, setEvents] = useState([])
  const [refRows, setRefRows] = useState([])
  const [jours, setJours] = useState([])
  const [artistes, setArtistes] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  // Le prénom de l'auteur : côté desk on le connaît, côté portail il est
  // saisi. Dans les deux cas il est écrit sur chaque modification.
  const authorName =
    profile?.prenom || profile?.full_name || profile?.email?.split('@')[0] || null

  const load = useCallback(async () => {
    // Toujours relâcher le chargement, même sans projet : sinon l'onglet
    // tourne indéfiniment au lieu d'afficher quelque chose.
    if (!projectId) {
      setLoading(false)
      return
    }
    try {
      const [rows, evts, refs, days, arts] = await Promise.all([
        listContenus(projectId),
        listContenuEvents(projectId),
        listContenuRefs(projectId),
        listProjetJours(projectId),
        listProjetArtistes(projectId),
      ])
      setContenus(rows)
      setEvents(evts)
      setRefRows(refs)
      setJours(days)
      setArtistes(arts)
    } catch (err) {
      notify.error('Contenus : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Amorce des espaces : les scènes du déroulé sont proposées tant que la
  // liste du module est vide. Elles ne sont jamais écrites d'office — le
  // festival ajoute aussi camping, village, site concert…
  const [scenesDeroule, setScenesDeroule] = useState([])
  useEffect(() => {
    if (!projectId) return
    let alive = true
    supabase
      .from('projet_deroule_lanes')
      // !inner : le filtre porte sur le projet du déroulé parent, sinon on
      // ramènerait les scènes de tous les projets lisibles.
      .select('libelle, deroule:deroule_id!inner(project_id)')
      .eq('type', 'lieu')
      .eq('deroule.project_id', projectId)
      .then(({ data, error }) => {
        // Sans droit sur le déroulé, on se passe simplement des suggestions.
        if (!alive || error) return
        setScenesDeroule([...new Set((data || []).map((l) => l.libelle).filter(Boolean))])
      })
    return () => {
      alive = false
    }
  }, [projectId])

  const refs = useMemo(() => {
    const espaces = refValues(refRows, 'espace')
    return {
      // Union ordonnée : la liste du module d'abord, les scènes du déroulé
      // en complément tant qu'elles n'y ont pas été reprises.
      espace: [...espaces, ...scenesDeroule.filter((s) => !espaces.some((e) => e.toLowerCase() === s.toLowerCase()))],
      photographe: refValues(refRows, 'photographe'),
      suivi: refValues(refRows, 'suivi'),
    }
  }, [refRows, scenesDeroule])

  async function handleCreateRef(kind, valeur) {
    try {
      const row = await createContenuRef({ projectId, kind, valeur, existing: refRows })
      if (row && !refRows.some((r) => r.id === row.id)) setRefRows((prev) => [...prev, row])
    } catch (err) {
      notify.error('Liste : ' + (err?.message || err))
    }
  }

  async function handlePatch(contenu, patch) {
    // Optimiste : la liste ne doit pas clignoter à chaque clic de statut.
    setContenus((prev) => prev.map((c) => (c.id === contenu.id ? { ...c, ...patch } : c)))
    try {
      const updated = await updateContenu(contenu.id, patch, {
        authorName,
        previousStatut: contenu.statut,
      })
      if (updated) {
        setContenus((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
        if (patch.statut && patch.statut !== contenu.statut) {
          const evts = await listContenuEvents(projectId)
          setEvents(evts)
        }
      }
    } catch (err) {
      notify.error('Enregistrement : ' + (err?.message || err))
      load()
    }
  }

  async function handleDelete(contenu) {
    const ok = await confirm({
      title: 'Supprimer ce contenu ?',
      message: 'Il disparaîtra de la liste et des liens partagés.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    setContenus((prev) => prev.filter((c) => c.id !== contenu.id))
    try {
      await deleteContenu(contenu.id)
    } catch (err) {
      notify.error('Suppression : ' + (err?.message || err))
      load()
    }
  }

  async function handleComment(contenu, text) {
    try {
      const evt = await addContenuEvent({
        projectId,
        contenuId: contenu.id,
        body: text,
        authorName,
      })
      if (evt) setEvents((prev) => [...prev, evt])
    } catch (err) {
      notify.error('Commentaire : ' + (err?.message || err))
    }
  }

  async function handleCreate(fields) {
    try {
      const created = await createContenu({ projectId, authorName, ...fields })
      setContenus((prev) => [created, ...prev])
      setAdding(false)
    } catch (err) {
      notify.error('Création : ' + (err?.message || err))
    }
  }

  if (!canRead) {
    return (
      <div className="p-8 text-center">
        <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--txt-3)' }} />
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Tu n&apos;as pas accès aux contenus de ce projet.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="w-6 h-6 mx-auto animate-spin" style={{ color: 'var(--txt-3)' }} />
      </div>
    )
  }

  return (
    <div className="p-5 max-w-7xl mx-auto pb-16 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-bg, rgba(249,115,22,0.14))' }}
        >
          <Images className="w-4 h-4" style={{ color: 'var(--accent, #f97316)' }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Contenus
          </h1>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            Suivi de validation des photos et vidéos
            {project?.title ? ` · ${project.title}` : ''}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ml-auto flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter un contenu
          </button>
        )}
      </header>

      {adding && (
        <ContenuForm
          refs={refs}
          jours={jours}
          artistes={artistes}
          onCancel={() => setAdding(false)}
          onSubmit={handleCreate}
          onCreateRef={handleCreateRef}
        />
      )}

      <ContenusTable
        contenus={contenus}
        events={events}
        canEdit={canEdit}
        refs={refs}
        jours={jours}
        artistes={artistes}
        onPatch={handlePatch}
        onDelete={handleDelete}
        onComment={handleComment}
        onCreateRef={handleCreateRef}
      />
    </div>
  )
}

// ─── Formulaire de création ────────────────────────────────────────────────

export function ContenuForm({ refs, jours, artistes, onCancel, onSubmit, onCreateRef }) {
  const [type, setType] = useState('photo')
  const [sujet, setSujet] = useState('')
  const [espace, setEspace] = useState(null)
  const [date, setDate] = useState(null)
  const [photographe, setPhotographe] = useState(null)
  const [driveUrl, setDriveUrl] = useState('')
  const [suiviPar, setSuiviPar] = useState(null)
  const [busy, setBusy] = useState(false)

  const inputStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  async function submit(e) {
    e.preventDefault()
    if (!sujet.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit({
        type,
        ...resolveSujet(sujet, artistes),
        espace: espace || null,
        date_contenu: date || null,
        photographe: photographe || null,
        drive_url: driveUrl.trim() || null,
        suivi_par: suiviPar || null,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl p-4 flex flex-col gap-2.5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--blue)' }}
    >
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--brd)' }}>
          {CONTENU_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className="text-xs font-semibold px-3 py-2"
              style={{
                background: type === t ? 'var(--blue-bg)' : 'var(--bg)',
                color: type === t ? 'var(--blue)' : 'var(--txt-2)',
              }}
            >
              {CONTENU_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <RefSelect
          value={sujet}
          options={artistes.map((a) => a.nom)}
          placeholder="Artiste ou moment *"
          className="flex-1 min-w-[180px]"
          onChange={(v) => setSujet(v || '')}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <RefSelect
          value={espace}
          options={refs.espace}
          placeholder="Espace (scène, camping…)"
          className="flex-1 min-w-[180px]"
          onChange={setEspace}
          onCreate={(v) => onCreateRef('espace', v)}
        />
        <JourSelect value={date} jours={jours} onChange={setDate} className="min-w-[160px]" />
        <RefSelect
          value={photographe}
          options={refs.photographe}
          placeholder="Photographe"
          className="flex-1 min-w-[160px]"
          onChange={setPhotographe}
          onCreate={(v) => onCreateRef('photographe', v)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="url"
          value={driveUrl}
          onChange={(e) => setDriveUrl(e.target.value)}
          placeholder="Lien drive"
          className="flex-1 min-w-[200px] text-xs px-2.5 py-2 rounded-lg outline-none"
          style={inputStyle}
        />
        <RefSelect
          value={suiviPar}
          options={refs.suivi}
          placeholder="Suivi par"
          className="flex-1 min-w-[160px]"
          onChange={setSuiviPar}
          onCreate={(v) => onCreateRef('suivi', v)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold px-3 py-2 rounded-lg"
          style={{ color: 'var(--txt-2)' }}
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy || !sujet.trim()}
          className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Ajouter
        </button>
      </div>
    </form>
  )
}

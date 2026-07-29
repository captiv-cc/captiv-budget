// ════════════════════════════════════════════════════════════════════════════
// TrajetModal — création / édition d'un trajet à étapes (Logistique V1, P2)
// ════════════════════════════════════════════════════════════════════════════
//
// Un trajet = un déplacement (aller / retour / autre) daté, composé de N
// étapes ordonnées : « Train 12339 · 10h42 · Gare de Lyon → Mtp St-Roch »
// puis « Minibus · 14h30 · St-Roch → Zénith (conducteur : Samuel) ».
// Le coût est global au trajet, optionnel, et n'apparaît JAMAIS sur les
// partages (décision Hugo). Ouvert depuis la grille (chip ou +) et depuis
// la fiche personne.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bus,
  Car,
  FileText,
  Loader2,
  Plane,
  Plus,
  Route,
  Train,
  TramFront,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  createTrajet,
  updateTrajet,
  deleteTrajet,
  uploadLogistiqueDoc,
  deleteLogistiqueDoc,
  getLogistiqueDocUrl,
  DOC_ACCEPT,
} from '../../lib/logistique'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

const MODES = [
  { value: 'train', label: 'Train', icon: Train },
  { value: 'minibus', label: 'Minibus', icon: Bus },
  { value: 'voiture', label: 'Voiture', icon: Car },
  { value: 'avion', label: 'Avion', icon: Plane },
  { value: 'autre', label: 'Autre', icon: TramFront },
]

const SENS_OPTIONS = [
  { value: 'aller', label: 'Aller' },
  { value: 'retour', label: 'Retour' },
  { value: 'autre', label: 'Autre' },
]

const EMPTY_ETAPE = { mode: 'train', heure: '', heure_arrivee: '', depart: '', arrivee: '', note: '' }

export default function TrajetModal({
  projectId,
  membre,          // row membre (nom affiché)
  membreName = '',
  trajet = null,   // null = création
  defaultDate = null,
  defaultSens = 'aller',
  docs = [],       // docs du trajet (parent_type='trajet')
  onSaved,         // (trajet) => void — reload côté appelant
  onDeleted,       // () => void
  onClose,
}) {
  // currentTrajet : après une CRÉATION, on bascule en mode édition sans
  // fermer — pour pouvoir attacher les billets dans la foulée.
  const [currentTrajet, setCurrentTrajet] = useState(trajet)
  const [sens, setSens] = useState(trajet?.sens || defaultSens)
  const [dateTrajet, setDateTrajet] = useState(trajet?.date_trajet || defaultDate || '')
  const [etapes, setEtapes] = useState(() =>
    Array.isArray(trajet?.etapes) && trajet.etapes.length
      ? trajet.etapes.map((e) => ({ ...EMPTY_ETAPE, ...e }))
      : [{ ...EMPTY_ETAPE }],
  )
  const [cout, setCout] = useState(trajet?.cout ?? '')
  const [notes, setNotes] = useState(trajet?.notes || '')
  const [saving, setSaving] = useState(false)
  const [localDocs, setLocalDocs] = useState(docs)
  const [uploading, setUploading] = useState(false)
  // Docs sélectionnés AVANT la création du trajet (retour Hugo : ne pas
  // attendre) — uploadés automatiquement juste après le create.
  const [pendingFiles, setPendingFiles] = useState([])

  // Esc ferme
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  function patchEtape(idx, patch) {
    setEtapes((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
  }
  function moveEtape(idx, dir) {
    setEtapes((prev) => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }
  function removeEtape(idx) {
    setEtapes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev))
  }

  async function handleSave() {
    if (saving) return
    // Étapes vides (aucun champ rempli) filtrées au save.
    const cleanEtapes = etapes.filter(
      (e) => e.heure.trim() || e.depart.trim() || e.arrivee.trim() || e.note.trim(),
    )
    setSaving(true)
    try {
      const payload = {
        sens,
        date_trajet: dateTrajet || null,
        etapes: cleanEtapes,
        cout: cout === '' ? null : Number(cout),
        notes: notes.trim() || null,
      }
      let saved
      if (currentTrajet?.id) {
        saved = await updateTrajet(currentTrajet.id, payload)
        notify.success('Trajet mis à jour')
        onSaved?.(saved)
        onClose?.()
      } else {
        saved = await createTrajet({
          projectId,
          membreId: membre.id,
          sens: payload.sens,
          dateTrajet: payload.date_trajet,
          etapes: payload.etapes,
          cout: payload.cout,
          notes: payload.notes,
        })
        // Création : upload des docs mis en attente, puis fermeture.
        setCurrentTrajet(saved)
        for (const f of pendingFiles) {
          try {
            const doc = await uploadLogistiqueDoc({
              projectId,
              parentType: 'trajet',
              parentId: saved.id,
              file: f,
            })
            setLocalDocs((prev) => [...prev, doc])
          } catch (err) {
            notify.error(`Upload ${f.name} : ` + (err?.message || err))
          }
        }
        setPendingFiles([])
        notify.success('Trajet créé')
        onSaved?.(saved)
        onClose?.()
      }
    } catch (err) {
      notify.error('Trajet : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(file) {
    if (!file || !currentTrajet?.id) return
    setUploading(true)
    try {
      const doc = await uploadLogistiqueDoc({
        projectId,
        parentType: 'trajet',
        parentId: currentTrajet.id,
        file,
      })
      setLocalDocs((prev) => [...prev, doc])
      onSaved?.(currentTrajet)
    } catch (err) {
      notify.error('Upload : ' + (err?.message || err))
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteDoc(doc) {
    try {
      await deleteLogistiqueDoc(doc)
      setLocalDocs((prev) => prev.filter((d) => d.id !== doc.id))
      onSaved?.(currentTrajet)
    } catch (err) {
      notify.error('Suppression doc : ' + (err?.message || err))
    }
  }

  async function handleOpenDoc(doc) {
    try {
      const url = await getLogistiqueDocUrl(doc)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      notify.error('Ouverture : ' + (err?.message || err))
    }
  }

  async function handleDelete() {
    if (!currentTrajet?.id) return
    const ok = await confirm({
      title: 'Supprimer ce trajet ?',
      message: 'Les étapes et le coût associés seront supprimés. Action irréversible.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      await deleteTrajet(currentTrajet.id)
      notify.success('Trajet supprimé')
      onDeleted?.()
      onClose?.()
    } catch (err) {
      notify.error('Suppression : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={() => !saving && onClose?.()}
      />
      <div
        className="relative w-full max-w-lg rounded-xl flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          maxHeight: 'calc(100vh - 32px)',
        }}
      >
        {/* Header — même gabarit que la modale Hébergements (icône carrée
            teintée + titre + sous-titre) pour l'uniformité des 3 modales. */}
        <div
          className="flex items-center gap-2.5 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Route className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              {currentTrajet?.id ? 'Modifier le trajet' : 'Nouveau trajet'}
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {membreName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            className="ml-auto p-1.5"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Sens + date + coût */}
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                Sens
              </span>
              <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--brd)' }}>
                {SENS_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setSens(o.value)}
                    className="text-xs font-semibold px-2.5 py-1.5"
                    style={{
                      background: sens === o.value ? 'var(--blue-bg)' : 'var(--bg)',
                      color: sens === o.value ? 'var(--blue)' : 'var(--txt-2)',
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                Date
              </span>
              <input
                type="date"
                value={dateTrajet || ''}
                onChange={(e) => setDateTrajet(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-md outline-none"
                style={inputStyle}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--txt-3)' }}
                title="Interne : jamais visible sur les partages"
              >
                Coût €
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cout}
                onChange={(e) => setCout(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-md outline-none w-[110px]"
                style={inputStyle}
              />
            </label>
          </div>

          {/* Étapes */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--txt-3)' }}>
              Étapes
            </p>
            <div className="flex flex-col gap-2.5">
              {etapes.map((e, idx) => {
                const ModeIcon = (MODES.find((m) => m.value === e.mode) || MODES[0]).icon
                return (
                  <div
                    key={idx}
                    className="rounded-xl overflow-hidden"
                    style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
                  >
                    {/* Barre de l'étape : n°, mode, actions */}
                    <div
                      className="flex items-center gap-2 px-3 py-2"
                      style={{ background: 'rgba(59,130,246,0.05)', borderBottom: '1px solid var(--brd-sub)' }}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
                      >
                        {idx + 1}
                      </span>
                      <ModeIcon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blue)' }} />
                      <select
                        value={e.mode}
                        onChange={(ev) => patchEtape(idx, { mode: ev.target.value })}
                        className="text-xs font-semibold px-1.5 py-1 rounded-md outline-none"
                        style={{ background: 'transparent', border: '1px solid transparent', color: 'var(--txt)' }}
                        onFocus={(ev) => (ev.currentTarget.style.borderColor = 'var(--brd)')}
                        onBlur={(ev) => (ev.currentTarget.style.borderColor = 'transparent')}
                      >
                        {MODES.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <span className="ml-auto flex items-center gap-0.5">
                        <IconBtn title="Monter" disabled={idx === 0} onClick={() => moveEtape(idx, -1)}>
                          <ArrowUp className="w-3 h-3" />
                        </IconBtn>
                        <IconBtn
                          title="Descendre"
                          disabled={idx === etapes.length - 1}
                          onClick={() => moveEtape(idx, 1)}
                        >
                          <ArrowDown className="w-3 h-3" />
                        </IconBtn>
                        <IconBtn
                          title="Supprimer l'étape"
                          disabled={etapes.length === 1}
                          onClick={() => removeEtape(idx)}
                          danger
                        >
                          <Trash2 className="w-3 h-3" />
                        </IconBtn>
                      </span>
                    </div>

                    {/* Départ → Arrivée : deux colonnes symétriques */}
                    <div className="px-3 py-2.5 flex items-end gap-2">
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}>
                          Départ
                        </span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={e.heure}
                            onChange={(ev) => patchEtape(idx, { heure: ev.target.value })}
                            className="text-xs px-1.5 py-1.5 rounded-md outline-none shrink-0 w-[86px]"
                            style={inputStyle}
                            title="Heure de départ"
                          />
                          <input
                            type="text"
                            value={e.depart}
                            onChange={(ev) => patchEtape(idx, { depart: ev.target.value })}
                            placeholder="Lieu (Gare de Lyon…)"
                            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md outline-none"
                            style={inputStyle}
                          />
                        </div>
                      </div>
                      <span className="pb-2 shrink-0" style={{ color: 'var(--blue)' }}>
                        →
                      </span>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}>
                          Arrivée
                        </span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={e.heure_arrivee}
                            onChange={(ev) => patchEtape(idx, { heure_arrivee: ev.target.value })}
                            className="text-xs px-1.5 py-1.5 rounded-md outline-none shrink-0 w-[86px]"
                            style={inputStyle}
                            title="Heure d'arrivée"
                          />
                          <input
                            type="text"
                            value={e.arrivee}
                            onChange={(ev) => patchEtape(idx, { arrivee: ev.target.value })}
                            placeholder="Lieu (Mtp St-Roch…)"
                            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md outline-none"
                            style={inputStyle}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Note discrète, pleine largeur, sans bordure */}
                    <input
                      type="text"
                      value={e.note}
                      onChange={(ev) => patchEtape(idx, { note: ev.target.value })}
                      placeholder="N° de train, conducteur, point de RDV…"
                      className="w-full text-[11px] px-3 py-2 outline-none"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderTop: '1px solid var(--brd-sub)',
                        color: 'var(--txt-2)',
                      }}
                    />
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setEtapes((prev) => [...prev, { ...EMPTY_ETAPE, mode: 'minibus' }])}
              className="mt-2 flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px dashed var(--brd)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter une étape
            </button>
          </div>

          {/* Notes */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Billets échangeables, arriver 20 min avant…"
              className="text-xs px-2 py-1.5 rounded-md outline-none resize-y"
              style={{ ...inputStyle, fontFamily: 'inherit' }}
            />
          </label>

          {/* Documents (billets) — dispo dès que le trajet existe en base. */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--txt-3)' }}>
              Billets &amp; documents
            </p>
            {!currentTrajet?.id && (
              <>
                {pendingFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-1.5"
                    style={{ background: 'var(--bg-surf)', border: '1px dashed var(--brd)' }}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                    <span className="text-xs truncate" style={{ color: 'var(--txt)' }}>
                      {f.name}
                    </span>
                    <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
                      envoyé à la création
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="ml-auto p-1 shrink-0"
                      style={{ color: 'var(--red, #ef4444)' }}
                      title="Retirer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <label
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md cursor-pointer"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt-2)',
                    border: '1px dashed var(--brd)',
                  }}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Ajouter un document
                  <input
                    type="file"
                    accept={DOC_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) setPendingFiles((prev) => [...prev, f])
                      e.target.value = ''
                    }}
                  />
                </label>
              </>
            )}
            {currentTrajet?.id ? (
              <>
                {localDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-1.5"
                    style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                    <button
                      type="button"
                      onClick={() => handleOpenDoc(doc)}
                      className="text-xs truncate text-left hover:underline"
                      style={{ color: 'var(--txt)', textUnderlineOffset: '2px' }}
                      title="Ouvrir dans un nouvel onglet"
                    >
                      {doc.filename}
                    </button>
                    {doc.size_bytes && (
                      <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
                        {(doc.size_bytes / 1024).toFixed(0)} Ko
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteDoc(doc)}
                      className="ml-auto p-1 shrink-0"
                      style={{ color: 'var(--red, #ef4444)' }}
                      title="Supprimer le document"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <label
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md cursor-pointer"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt-2)',
                    border: '1px dashed var(--brd)',
                  }}
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  Ajouter un document
                  <input
                    type="file"
                    accept={DOC_ACCEPT}
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      handleUpload(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
              </>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          {currentTrajet?.id && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-lg"
              style={{ color: 'var(--red, #ef4444)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer
            </button>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => !saving && onClose?.()}
              className="text-xs font-semibold px-3 py-2 rounded-lg"
              style={{ color: 'var(--txt-2)' }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
              style={{ background: 'var(--blue)', color: '#fff' }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {currentTrajet?.id ? 'Enregistrer' : 'Créer le trajet'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1 rounded transition-all disabled:opacity-25"
      style={{ color: danger ? 'var(--red, #ef4444)' : 'var(--txt-3)' }}
    >
      {children}
    </button>
  )
}

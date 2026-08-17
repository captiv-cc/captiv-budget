// ════════════════════════════════════════════════════════════════════════════
// HebergementsModal — gestion des hébergements du projet (Logistique V1, P2)
// ════════════════════════════════════════════════════════════════════════════
//
// Un hébergement = nom + type libre + adresse + notes plein texte + documents
// (résa PDF/PNG/JPG) + PERSONNES rattachées (chambre, PDJ) — le rattachement
// se fait ICI directement (retour Hugo : « comment attribuer un logement à
// une personne ? »), en plus de la fiche personne. Les nuits cochées de la
// grille pointent dessus → rooming list / totaux chambres par nuit en P3.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import {
  BedDouble,
  Coffee,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  createHebergement,
  updateHebergement,
  deleteHebergement,
  upsertHebergementMembre,
  deleteHebergementMembre,
  moveMembreNuits,
  adoptNuitsSansHebergement,
  uploadLogistiqueDoc,
  deleteLogistiqueDoc,
  DOC_ACCEPT,
} from '../../lib/logistique'
import {
  DocPreviewModal,
  DocDropZone,
  docIsImage,
  downloadDoc,
} from './LogistiqueDocViewer'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

function membreName(m) {
  const prenom = m.contact?.prenom || m.prenom || ''
  const nom = m.contact?.nom || m.nom || ''
  return `${prenom} ${nom}`.trim() || 'Sans nom'
}

function shortDate(iso) {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

/**
 * « 20 → 25 août · 5 nuits » — la plage rend lisible le cas d'une personne
 * répartie sur deux hébergements (A puis B).
 */
function formatSejour(dates) {
  if (!dates.length) return '0 nuit'
  const sorted = [...dates].sort()
  const out = new Date(`${sorted[sorted.length - 1]}T12:00:00`)
  out.setDate(out.getDate() + 1)
  const label = `${shortDate(sorted[0])} → ${shortDate(out.toISOString().slice(0, 10))}`
  return `${label} · ${sorted.length} nuit${sorted.length > 1 ? 's' : ''}`
}

export default function HebergementsModal({
  projectId,
  hebergements = [],
  hebergementMembres = [],
  membres = [], // rows principales techlist (fusionnées comme la Crew list)
  nuits = [], // projet_logistique_nuits — SOURCE du rattachement (modèle Hugo)
  docs = [], // projet_logistique_docs (tous parents)
  onMutated, // reload côté appelant
  onClose,
}) {
  const [editingId, setEditingId] = useState(null) // id | 'new' | null
  const [busy, setBusy] = useState(false)

  async function run(fn, successMsg) {
    setBusy(true)
    try {
      await fn()
      if (successMsg) notify.success(successMsg)
      await onMutated?.()
      return true
    } catch (err) {
      notify.error(err?.message || String(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(h) {
    const n = hebergementMembres.filter((hm) => hm.hebergement_id === h.id).length
    const ok = await confirm({
      title: `Supprimer « ${h.nom} » ?`,
      message: n
        ? `${n} personne${n > 1 ? 's' : ''} y ${n > 1 ? 'sont rattachées' : 'est rattachée'} — les rattachements seront supprimés, les nuits cochées resteront (sans hébergement).`
        : 'Aucune personne rattachée. Action irréversible.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    await run(() => deleteHebergement(h.id), 'Hébergement supprimé')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={() => !busy && onClose?.()}
      />
      <div
        className="relative w-full max-w-2xl rounded-xl flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          maxHeight: 'calc(100vh - 32px)',
        }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(167,139,250,0.14)' }}
          >
            <BedDouble className="w-4 h-4" style={{ color: 'var(--purple, #a78bfa)' }} />
          </div>
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Hébergements du projet
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            className="ml-auto p-1.5"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* min-h-0 : sans ça un enfant flex garde min-height:auto, refuse de
            se rétracter sous son contenu et le scroll ne s'active jamais. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {hebergements.length === 0 && editingId !== 'new' && (
            <p className="text-xs text-center py-6" style={{ color: 'var(--txt-3)' }}>
              Aucun hébergement déclaré.
            </p>
          )}

          {/* Nuits cochées avant que l'hôtel soit connu : affectation ici. */}
          {hebergements.length > 0 &&
            (() => {
              const orphans = nuits.filter((n) => !n.hebergement_id)
              if (!orphans.length) return null
              const byMembre = new Map()
              for (const n of orphans) {
                byMembre.set(n.membre_id, (byMembre.get(n.membre_id) || 0) + 1)
              }
              const membreById = new Map(membres.map((m) => [m.id, m]))
              return (
                <div
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: 'rgba(245,158,11,0.06)',
                    border: '1px solid rgba(245,158,11,0.35)',
                  }}
                >
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--amber, #f59e0b)', letterSpacing: '0.08em' }}
                  >
                    Nuits sans hébergement
                  </p>
                  {Array.from(byMembre.entries()).map(([membreId, count]) => {
                    const m = membreById.get(membreId)
                    return (
                      <div
                        key={membreId}
                        className="flex items-center gap-2 py-1"
                        style={{ borderTop: '1px solid var(--brd-sub)' }}
                      >
                        <span className="text-xs font-semibold min-w-0 truncate" style={{ color: 'var(--txt)' }}>
                          {m ? membreName(m) : 'Membre supprimé'}
                        </span>
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
                          {count} nuit{count > 1 ? 's' : ''}
                        </span>
                        <select
                          value=""
                          onChange={(e) => {
                            const hebId = e.target.value
                            if (!hebId) return
                            run(
                              () => adoptNuitsSansHebergement(projectId, hebId, membreId),
                              'Nuits affectées',
                            )
                          }}
                          className="text-[11px] px-2 py-1 rounded-md outline-none ml-auto"
                          style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
                        >
                          <option value="">Affecter à…</option>
                          {hebergements.map((heb) => (
                            <option key={heb.id} value={heb.id}>
                              {heb.nom}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          {hebergements.map((h) =>
            editingId === h.id ? (
              <HebergementForm
                key={h.id}
                initial={h}
                busy={busy}
                onCancel={() => setEditingId(null)}
                onSubmit={async (fields) => {
                  const ok = await run(() => updateHebergement(h.id, fields), 'Hébergement mis à jour')
                  if (ok) setEditingId(null)
                }}
              />
            ) : (
              <HebergementCard
                key={h.id}
                hebergement={h}
                assigned={hebergementMembres.filter((hm) => hm.hebergement_id === h.id)}
                nuits={nuits.filter((n) => n.hebergement_id === h.id)}
                allHebs={hebergements}
                membres={membres}
                docs={docs.filter(
                  (doc) => doc.parent_type === 'hebergement' && doc.parent_id === h.id,
                )}
                projectId={projectId}
                onEdit={() => setEditingId(h.id)}
                onDelete={() => handleDelete(h)}
                run={run}
              />
            ),
          )}

          {editingId === 'new' ? (
            <HebergementForm
              busy={busy}
              onCancel={() => setEditingId(null)}
              onSubmit={async (fields) => {
                const isFirst = hebergements.length === 0
                const ok = await run(async () => {
                  const created = await createHebergement({ projectId, ...fields })
                  // 1er hébergement du projet : les nuits déjà cochées
                  // (sans hébergement) le rejoignent automatiquement.
                  if (isFirst) {
                    const n = await adoptNuitsSansHebergement(projectId, created.id)
                    if (n > 0) notify.success(`${n} nuit${n > 1 ? 's' : ''} existante${n > 1 ? 's' : ''} affectée${n > 1 ? 's' : ''}`)
                  }
                }, 'Hébergement créé')
                if (ok) setEditingId(null)
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingId('new')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg self-start"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px dashed var(--brd)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter un hébergement
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Carte d'un hébergement : infos + docs + personnes ─────────────────────

function HebergementCard({
  hebergement: h,
  assigned,
  nuits = [],
  allHebs = [],
  membres,
  docs,
  projectId,
  onEdit,
  onDelete,
  run,
}) {
  const [uploading, setUploading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)
  const membreById = new Map(membres.map((m) => [m.id, m]))
  // Rooming DÉRIVÉ des nuits (modèle validé Hugo) : quiconque a ≥ 1 nuit
  // cochée ici apparaît automatiquement. Les rows hebergement_membres ne
  // portent plus que chambre/PDJ (créées à la volée au premier edit).
  // Dates par personne : indispensable dès qu'une personne change de logement
  // en cours de projet (A jusqu'au 24, B ensuite) — chaque carte montre la
  // plage qui la concerne.
  const datesByMembre = new Map()
  for (const n of nuits) {
    const arr = datesByMembre.get(n.membre_id) || []
    arr.push(n.date_nuit)
    datesByMembre.set(n.membre_id, arr)
  }
  const nuitCountByMembre = new Map(
    Array.from(datesByMembre.entries()).map(([id, dates]) => [id, dates.length]),
  )
  const hmByMembre = new Map(assigned.map((hm) => [hm.membre_id, hm]))
  const personIds = Array.from(
    new Set([...nuitCountByMembre.keys(), ...assigned.map((hm) => hm.membre_id)]),
  ).sort((a, b) =>
    membreName(membreById.get(a) || {}).localeCompare(
      membreName(membreById.get(b) || {}),
      'fr',
    ),
  )

  async function handleUploadFiles(files) {
    const list = Array.from(files || []).filter(Boolean)
    if (list.length === 0) return
    setUploading(true)
    try {
      for (const file of list) {
        try {
          await uploadLogistiqueDoc({
            projectId,
            parentType: 'hebergement',
            parentId: h.id,
            file,
          })
        } catch (err) {
          notify.error(`Upload ${file.name} : ` + (err?.message || err))
        }
      }
      await run(() => Promise.resolve())
    } finally {
      setUploading(false)
    }
  }

  async function handleDownloadDoc(doc) {
    try {
      await downloadDoc(doc)
    } catch (err) {
      notify.error('Téléchargement : ' + (err?.message || err))
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      {/* En-tête */}
      <div
        className="flex items-start gap-3 px-4 py-3"
        style={{ background: 'rgba(167,139,250,0.06)', borderBottom: '1px solid var(--brd-sub)' }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--txt)' }}>
            {h.nom}
            {h.type && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{
                  background: 'rgba(167,139,250,0.16)',
                  color: 'var(--purple, #a78bfa)',
                  letterSpacing: '0.06em',
                }}
              >
                {h.type}
              </span>
            )}
          </p>
          {h.adresse && (
            <p className="text-xs mt-0.5 flex items-start gap-1 whitespace-pre-line" style={{ color: 'var(--txt-2)' }}>
              <MapPin className="w-3 h-3 mt-0.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
              {h.adresse}
            </p>
          )}
        </div>
        <span className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onEdit} className="p-1.5 rounded-md" style={{ color: 'var(--txt-3)' }} title="Modifier">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onDelete} className="p-1.5 rounded-md" style={{ color: 'var(--red, #ef4444)' }} title="Supprimer">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {h.notes && (
          <p className="text-xs whitespace-pre-line" style={{ color: 'var(--txt-2)' }}>
            {h.notes}
          </p>
        )}

        {/* Documents — clic = aperçu, drag & drop sur la zone */}
        <DocDropZone onFiles={handleUploadFiles} disabled={uploading}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {docs.map((doc) => {
            const DocIcon = docIsImage(doc) ? ImageIcon : FileText
            return (
            <span
              key={doc.id}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md"
              style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
            >
              <DocIcon className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
              <button
                type="button"
                onClick={() => setPreviewDoc(doc)}
                className="hover:underline max-w-[180px] truncate"
                style={{ color: 'var(--txt)', textUnderlineOffset: '2px' }}
                title="Aperçu"
              >
                {doc.filename}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadDoc(doc)}
                style={{ color: 'var(--txt-3)' }}
                title="Télécharger"
              >
                <Download className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => run(() => deleteLogistiqueDoc(doc), 'Document supprimé')}
                style={{ color: 'var(--red, #ef4444)' }}
                title="Supprimer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
            )
          })}
          <label
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md cursor-pointer"
            style={{ color: 'var(--txt-3)', border: '1px dashed var(--brd)' }}
            title="Ajouter des documents (résa, plan d'accès…) — PDF, PNG, JPG, ou glisser-déposer"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            Doc
            <input
              type="file"
              accept={DOC_ACCEPT}
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                handleUploadFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        </DocDropZone>

        {previewDoc && (
          <DocPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
        )}

        {/* Personnes — rooming dérivé des nuits de la grille */}
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
          >
            Personnes · {personIds.length}
          </p>
          {personIds.length === 0 && (
            <p className="text-[11px] italic" style={{ color: 'var(--txt-3)' }}>
              Personne pour l&apos;instant — coche des nuits 🌙 dans la grille, les
              personnes apparaîtront ici automatiquement.
            </p>
          )}
          {personIds.map((membreId) => {
            const m = membreById.get(membreId)
            const hm = hmByMembre.get(membreId) || null
            const nCount = nuitCountByMembre.get(membreId) || 0
            return (
              <div
                key={membreId}
                className="flex items-center gap-2 py-1 flex-wrap"
                style={{ borderTop: '1px solid var(--brd-sub)' }}
              >
                {/* min-w + wrap : sur mobile, chambre/PDJ passent à la ligne
                    au lieu de tronquer le nom à quelques lettres. */}
                <span
                  className="text-xs font-semibold flex-1 truncate"
                  style={{ color: 'var(--txt)', minWidth: '140px' }}
                >
                  {m ? membreName(m) : 'Membre supprimé'}
                </span>
                <span
                  className="text-[10px] shrink-0"
                  style={{ color: nCount ? 'var(--txt-3)' : 'var(--amber, #f59e0b)' }}
                  title={
                    nCount
                      ? 'Nuits cochées dans la grille'
                      : 'Plus aucune nuit ici — infos chambre/PDJ conservées'
                  }
                >
                  {formatSejour(datesByMembre.get(membreId) || [])}
                </span>
                <input
                  type="text"
                  defaultValue={hm?.chambre || ''}
                  placeholder="Chambre"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null
                    if (v !== (hm?.chambre || null)) {
                      run(() =>
                        upsertHebergementMembre({
                          projectId,
                          hebergementId: h.id,
                          membreId,
                          patch: { chambre: v },
                        }),
                      )
                    }
                  }}
                  className="w-[90px] text-[11px] px-2 py-1 rounded-md outline-none ml-auto"
                  style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
                />
                <button
                  type="button"
                  onClick={() =>
                    run(() =>
                      upsertHebergementMembre({
                        projectId,
                        hebergementId: h.id,
                        membreId,
                        patch: { pdj: !hm?.pdj },
                      }),
                    )
                  }
                  className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded-md shrink-0"
                  style={{
                    background: hm?.pdj ? 'rgba(167,139,250,0.16)' : 'transparent',
                    color: hm?.pdj ? 'var(--purple, #a78bfa)' : 'var(--txt-3)',
                    border: `1px solid ${hm?.pdj ? 'rgba(167,139,250,0.4)' : 'var(--brd-sub)'}`,
                  }}
                  title="Petit-déjeuner inclus"
                >
                  <Coffee className="w-3 h-3" />
                  PDJ
                </button>
                {/* Changement d'hôtel : déplace toutes les nuits (+ chambre/
                    PDJ) de la personne vers un autre hébergement. */}
                {allHebs.length > 1 && nCount > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const toId = e.target.value
                      if (!toId) return
                      run(
                        () =>
                          moveMembreNuits({
                            projectId,
                            membreId,
                            fromHebergementId: h.id,
                            toHebergementId: toId,
                          }),
                        'Nuits déplacées',
                      )
                    }}
                    className="text-[10px] px-1 py-1 rounded-md outline-none shrink-0 max-w-[110px]"
                    style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-3)' }}
                    title="Déplacer TOUTES les nuits vers un autre hébergement. Pour n'en basculer qu'une partie (changement de logement en cours de séjour), clique la nuit 🌙 concernée dans la grille."
                  >
                    <option value="">Tout déplacer…</option>
                    {allHebs
                      .filter((o) => o.id !== h.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nom}
                        </option>
                      ))}
                  </select>
                )}
                {/* Nettoyage : ne se propose que pour une row chambre/PDJ
                    orpheline (0 nuit) — sinon le rooming suit les nuits. */}
                {hm && nCount === 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      run(
                        () => deleteHebergementMembre({ hebergementId: h.id, membreId }),
                        'Infos retirées',
                      )
                    }
                    className="p-1 shrink-0"
                    style={{ color: 'var(--txt-3)' }}
                    title="Retirer les infos chambre/PDJ (aucune nuit ici)"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Formulaire création / édition ─────────────────────────────────────────

function HebergementForm({ initial = null, busy, onSubmit, onCancel }) {
  const [nom, setNom] = useState(initial?.nom || '')
  const [type, setType] = useState(initial?.type || '')
  const [adresse, setAdresse] = useState(initial?.adresse || '')
  const [notes, setNotes] = useState(initial?.notes || '')

  const inputStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!nom.trim()) return
        onSubmit({
          nom: nom.trim(),
          type: type.trim() || null,
          adresse: adresse.trim() || null,
          notes: notes.trim() || null,
        })
      }}
      className="rounded-xl p-4 flex flex-col gap-2.5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--blue)' }}
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Nom (ex. Lagrange apart'HOTEL) *"
          autoFocus
          className="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-md outline-none"
          style={inputStyle}
        />
        <input
          type="text"
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="Type (hôtel, Airbnb…)"
          className="w-[150px] text-xs px-2.5 py-2 rounded-md outline-none"
          style={inputStyle}
        />
      </div>
      <textarea
        value={adresse}
        onChange={(e) => setAdresse(e.target.value)}
        placeholder="Adresse"
        rows={2}
        className="text-xs px-2.5 py-2 rounded-md outline-none resize-y"
        style={{ ...inputStyle, fontFamily: 'inherit' }}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (code d'accès, contact résa, horaires de réception…)"
        rows={3}
        className="text-xs px-2.5 py-2 rounded-md outline-none resize-y"
        style={{ ...inputStyle, fontFamily: 'inherit' }}
      />
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
          disabled={busy || !nom.trim()}
          className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          {initial ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </form>
  )
}

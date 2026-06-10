// ════════════════════════════════════════════════════════════════════════════
// LoueurRecapPanel — panneau latéral (slide-over) du récap par loueur
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche le récap agrégé par loueur de la version active :
//   Loueur A : 2× FX6, 1× 24-70mm
//   Loueur B : 1× 16-35mm
//
// L'agrégation est déjà calculée amont (lib/materiel → computeRecapByLoueur) :
// on reçoit directement `[{ loueur, lignes: [{ designation, qte, key, materielBddId }] }]`.
//
// Chaque carte loueur a un bouton "PDF" qui génère un PDF pour CE loueur puis
// remonte le résultat au parent via `onPreview(result, title)` pour ouvrir la
// prévisualisation. (MAT-7)
//
// MAT-20 : une affordance d'édition "Infos logistique" par loueur permet de
// saisir un texte libre (horaires, adresse retrait, contact chantier, caution).
// L'UI reste COMPACTE par défaut — un petit bouton + pastille si des infos
// existent — et s'étend en textarea au clic. On NE rend PAS le texte en mode
// browsing (décision Hugo MAT-20) : l'info est réservée aux PDFs.
//
// Props :
//   - open : boolean
//   - onClose : close handler
//   - recap : Array<{ loueur, lignes }>
//   - activeVersionLabel : string (ex. "V2 — Tournage nov.")
//   - project, activeVersion, org : pour l'entête PDF
//   - onPreview(result, title) : appelé après génération — le parent affiche
//                                la preview et gère le revoke.
//   - infosLogistiqueByLoueur : Map(loueur_id -> { infos_logistique, ... }) — MAT-20
//   - onSaveInfos(loueurId, text) : handler async pour persister — MAT-20
//   - canEdit : gating de l'édition — MAT-20
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  Info,
  Users,
  X,
} from 'lucide-react'
import { exportMatosLoueurSinglePDF } from '../matosPdfExport'
import { isUnassignedRecap } from '../../../lib/materiel'
import { notify } from '../../../lib/notify'

/** Opacifie une couleur hex (#RRGGBB) pour les backgrounds pastels. */
function alpha(hex, a = '22') {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#64748b' + a
  return hex + a
}

export default function LoueurRecapPanel({
  open,
  onClose,
  recap = [],
  activeVersionLabel = '',
  project = null,
  activeVersion = null,
  org = null,
  onPreview,
  infosLogistiqueByLoueur = null, // MAT-20 — Map(loueur_id -> row)
  onSaveInfos = null,             // MAT-20 — async handler (loueurId, text) => row|null
  canEdit = false,                // MAT-20 — gate édition
}) {
  // Escape pour fermer.
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Compteur total items agrégés (pour header) — on NE compte que les vrais
  // loueurs dans le header, le groupe "Non assigné" est signalé à part pour
  // ne pas inflate le chiffre côté fait-accompli.
  const totals = useMemo(() => {
    const realGroups = recap.filter((r) => !isUnassignedRecap(r))
    const loueurs = realGroups.length
    let lignes = 0
    let unites = 0
    for (const r of realGroups) {
      lignes += r.lignes.length
      for (const l of r.lignes) unites += l.qte || 0
    }
    return { loueurs, lignes, unites }
  }, [recap])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Slide-over */}
      <aside
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(520px, 100vw)',
          background: 'var(--bg-elev)',
          borderLeft: '1px solid var(--brd)',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.2)',
        }}
        role="dialog"
        aria-label="Récap par loueur"
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Users className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Récap par loueur
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {activeVersionLabel && <span>{activeVersionLabel} · </span>}
              {totals.loueurs} {totals.loueurs > 1 ? 'loueurs' : 'loueur'} ·{' '}
              {totals.lignes} {totals.lignes > 1 ? 'références' : 'référence'} ·{' '}
              {totals.unites} {totals.unites > 1 ? 'unités' : 'unité'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer"
            className="ml-auto p-1.5 rounded-md transition-all"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-5">
          {recap.length === 0 ? (
            <EmptyRecap />
          ) : (
            <div className="flex flex-col gap-4">
              {recap.map((r) => {
                const vli = infosLogistiqueByLoueur?.get?.(r.loueur.id) || null
                return (
                  <LoueurCard
                    key={r.loueur.id}
                    recap={r}
                    project={project}
                    activeVersion={activeVersion}
                    org={org}
                    onPreview={onPreview}
                    infosRow={vli}
                    onSaveInfos={onSaveInfos}
                    canEdit={canEdit}
                  />
                )
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

// ─── Carte par loueur ──────────────────────────────────────────────────────

function LoueurCard({
  recap,
  project,
  activeVersion,
  org,
  onPreview,
  infosRow = null,
  onSaveInfos = null,
  canEdit = false,
}) {
  const { loueur, lignes } = recap
  const couleur = loueur.couleur || '#64748b'
  const isUnassigned = isUnassignedRecap(recap)
  const [generating, setGenerating] = useState(false)
  const inflightRef = useRef(false)

  const infosLogistique = (infosRow?.infos_logistique || '').trim()

  async function handlePdf() {
    if (inflightRef.current) return
    if (!onPreview) return
    if (isUnassigned) return // MAT-18 : pas de PDF pour "Non assigné"
    inflightRef.current = true
    setGenerating(true)
    try {
      const result = await exportMatosLoueurSinglePDF({
        project,
        activeVersion,
        loueur,
        lignes,
        org,
        infosLogistique,
      })
      onPreview(result, `Matériel — ${loueur.nom}`)
    } catch (err) {
      notify.error('Erreur export PDF : ' + (err?.message || err))
    } finally {
      inflightRef.current = false
      setGenerating(false)
    }
  }

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        // Bordure pointillée pour signaler "à attribuer" vs loueur effectif.
        border: isUnassigned
          ? `1px dashed ${alpha(couleur, '88')}`
          : `1px solid ${alpha(couleur, '55')}`,
      }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: alpha(couleur, '18'),
          borderBottom: `1px solid ${alpha(couleur, '44')}`,
        }}
      >
        {isUnassigned ? (
          <AlertTriangle
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: couleur }}
          />
        ) : (
          <span
            className="inline-block rounded-full shrink-0"
            style={{
              width: '10px',
              height: '10px',
              background: couleur,
            }}
          />
        )}
        <h3
          className="text-xs font-bold uppercase tracking-wider truncate"
          style={{ color: couleur, letterSpacing: '0.08em' }}
        >
          {loueur.nom}
        </h3>
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
          style={{ background: alpha(couleur, '22'), color: couleur }}
        >
          {lignes.length}
        </span>

        {/* PDF (MAT-7) — masqué pour le groupe "Non assigné" (MAT-18) :
            il n'a pas de destinataire, exporter un PDF n'a pas de sens. */}
        {!isUnassigned && (
          <button
            type="button"
            onClick={handlePdf}
            disabled={generating || !onPreview}
            className="ml-1 flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-all"
            style={{
              background: 'transparent',
              color: generating ? 'var(--txt-3)' : couleur,
              cursor: generating || !onPreview ? 'not-allowed' : 'pointer',
              opacity: generating || !onPreview ? 0.6 : 1,
              border: `1px solid ${alpha(couleur, '44')}`,
            }}
            onMouseEnter={(e) => {
              if (!generating && onPreview) {
                e.currentTarget.style.background = alpha(couleur, '18')
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            title={`Exporter le PDF de ${loueur.nom}`}
          >
            {generating ? (
              <span
                className="inline-block w-3 h-3 border-2 rounded-full animate-spin"
                style={{
                  borderColor: couleur,
                  borderTopColor: 'transparent',
                }}
              />
            ) : (
              <Download className="w-3 h-3" />
            )}
            PDF
          </button>
        )}
      </header>

      {/* MAT-20 — Édition infos logistique (cachée pour "Non assigné"). */}
      {!isUnassigned && (
        <LoueurInfoEditor
          loueurId={loueur.id}
          couleur={couleur}
          infosLogistique={infosLogistique}
          onSaveInfos={onSaveInfos}
          canEdit={canEdit}
        />
      )}

      <table className="w-full text-xs">
        <thead>
          <tr
            style={{
              borderBottom: '1px solid var(--brd-sub)',
              color: 'var(--txt-3)',
            }}
          >
            <th
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-left"
              style={{ letterSpacing: '0.08em' }}
            >
              Désignation
            </th>
            <th
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-right"
              style={{ letterSpacing: '0.08em', width: '60px' }}
            >
              Qté
            </th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr
              key={l.key}
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              <td className="px-3 py-1.5" style={{ color: 'var(--txt)' }}>
                {l.label && (
                  <>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        color: 'var(--txt-3)',
                        letterSpacing: '0.08em',
                      }}
                    >
                      {l.label}
                    </span>
                    <span
                      className="mx-1.5"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      ·
                    </span>
                  </>
                )}
                {l.designation}
              </td>
              <td
                className="px-3 py-1.5 text-right font-bold tabular-nums"
                style={{ color: couleur }}
              >
                ×{l.qte}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ─── Éditeur infos logistique (MAT-20) ─────────────────────────────────────
//
// UI compacte : un bouton "Infos logistique" discret (avec pastille colorée
// si des infos existent). Au clic, il se transforme en textarea avec
// Enregistrer / Annuler. On sauve au clic sur Enregistrer, ou au blur si
// le texte a changé (UX fire-and-forget). Vider le champ supprime la ligne.
//
// Le texte N'EST PAS rendu en mode browsing — décision Hugo MAT-20, pour
// éviter le clutter dans le slide-over. Il apparaît UNIQUEMENT dans les PDFs.

function LoueurInfoEditor({
  loueurId,
  couleur,
  infosLogistique,
  onSaveInfos,
  canEdit,
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(infosLogistique || '')
  const [saving, setSaving] = useState(false)
  const inflightRef = useRef(false)
  const textareaRef = useRef(null)

  // Resync valeur locale quand la prop change et qu'on n'est pas en édition
  // (ex. autre onglet qui a sauvé, Realtime).
  useEffect(() => {
    if (!open) setValue(infosLogistique || '')
  }, [infosLogistique, open])

  // Focus + select-all au passage en édition.
  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [open])

  const hasInfos = Boolean(infosLogistique)
  const dirty = value !== (infosLogistique || '')

  async function commit() {
    if (inflightRef.current) return
    if (!onSaveInfos) {
      setOpen(false)
      return
    }
    if (!dirty) {
      setOpen(false)
      return
    }
    inflightRef.current = true
    setSaving(true)
    try {
      await onSaveInfos(loueurId, value)
      setOpen(false)
    } catch (err) {
      notify.error('Erreur sauvegarde : ' + (err?.message || err))
    } finally {
      inflightRef.current = false
      setSaving(false)
    }
  }

  function cancel() {
    setValue(infosLogistique || '')
    setOpen(false)
  }

  // Mode compact — bouton seul. Read-only : on masque complètement le
  // bouton s'il n'y a rien à afficher (pas de teasing d'édition).
  if (!open) {
    if (!canEdit && !hasInfos) return null
    return (
      <div
        className="flex items-center gap-1.5 px-3 py-1.5"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <button
          type="button"
          onClick={() => canEdit && setOpen(true)}
          disabled={!canEdit}
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md transition-all"
          style={{
            letterSpacing: '0.08em',
            color: hasInfos ? couleur : 'var(--txt-3)',
            background: hasInfos ? alpha(couleur, '12') : 'transparent',
            border: `1px solid ${hasInfos ? alpha(couleur, '33') : 'var(--brd-sub)'}`,
            cursor: canEdit ? 'pointer' : 'default',
            opacity: canEdit ? 1 : 0.85,
          }}
          title={
            hasInfos
              ? 'Infos logistique définies (cliquer pour modifier)'
              : 'Ajouter des infos logistique (horaires, retrait, contact…)'
          }
          onMouseEnter={(e) => {
            if (canEdit) {
              e.currentTarget.style.background = alpha(couleur, '18')
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = hasInfos
              ? alpha(couleur, '12')
              : 'transparent'
          }}
        >
          {hasInfos ? (
            <Check className="w-3 h-3" style={{ color: couleur }} />
          ) : (
            <Info className="w-3 h-3" />
          )}
          Infos logistique
          {hasInfos && (
            <span
              className="inline-block rounded-full"
              style={{
                width: '6px',
                height: '6px',
                background: couleur,
              }}
            />
          )}
        </button>
        <span
          className="text-[10px]"
          style={{ color: 'var(--txt-3)' }}
        >
          {hasInfos ? '· rendues dans le PDF' : '· optionnel'}
        </span>
      </div>
    )
  }

  // Mode expanded — textarea + actions.
  return (
    <div
      className="flex flex-col gap-2 px-3 py-2"
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        background: alpha(couleur, '08'),
      }}
    >
      <label
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: couleur, letterSpacing: '0.08em' }}
      >
        Infos logistique (horaires · retrait · contact · caution…)
      </label>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit()
          }
        }}
        disabled={saving}
        placeholder="Ex. Retrait 11 rue X, lundi 9h–12h · Contact: Julie 06…"
        rows={3}
        className="w-full text-xs rounded-md p-2 resize-y"
        style={{
          background: 'var(--bg-elev)',
          border: `1px solid ${alpha(couleur, '55')}`,
          color: 'var(--txt)',
          outline: 'none',
          fontFamily: 'inherit',
          minHeight: '70px',
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={commit}
          disabled={saving || !dirty}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md transition-all"
          style={{
            letterSpacing: '0.08em',
            background: dirty ? couleur : alpha(couleur, '33'),
            color: dirty ? '#fff' : 'var(--txt-3)',
            border: `1px solid ${couleur}`,
            cursor: saving || !dirty ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
          title="Enregistrer (⌘↵)"
        >
          {saving ? (
            <span
              className="inline-block w-3 h-3 border-2 rounded-full animate-spin"
              style={{
                borderColor: '#fff',
                borderTopColor: 'transparent',
              }}
            />
          ) : (
            <Check className="w-3 h-3" />
          )}
          Enregistrer
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md transition-all"
          style={{
            letterSpacing: '0.08em',
            background: 'transparent',
            color: 'var(--txt-3)',
            border: '1px solid var(--brd-sub)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
          title="Annuler (Échap)"
        >
          Annuler
        </button>
        <span
          className="ml-auto text-[10px]"
          style={{ color: 'var(--txt-3)' }}
        >
          ⌘↵ pour enregistrer
        </span>
      </div>
    </div>
  )
}

// ─── Empty ─────────────────────────────────────────────────────────────────

function EmptyRecap() {
  return (
    <div
      className="rounded-xl p-6 text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px dashed var(--brd)',
      }}
    >
      <FileText
        className="w-8 h-8 mx-auto mb-3 opacity-40"
        style={{ color: 'var(--txt-3)' }}
      />
      <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
        Aucun loueur affecté
      </p>
      <p className="text-xs mt-1.5" style={{ color: 'var(--txt-3)' }}>
        Affecte un loueur à un item pour voir apparaître son récap.
      </p>
    </div>
  )
}

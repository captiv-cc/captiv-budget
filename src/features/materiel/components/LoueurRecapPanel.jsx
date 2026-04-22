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
// Props :
//   - open : boolean
//   - onClose : close handler
//   - recap : Array<{ loueur, lignes }>
//   - activeVersionLabel : string (ex. "V2 — Tournage nov.")
//   - project, activeVersion, org : pour l'entête PDF
//   - onPreview(result, title) : appelé après génération — le parent affiche
//                                la preview et gère le revoke.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, Users, X } from 'lucide-react'
import { exportMatosLoueurSinglePDF } from '../matosPdfExport'
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

  // Compteur total items agrégés (pour header)
  const totals = useMemo(() => {
    const loueurs = recap.length
    let lignes = 0
    let unites = 0
    for (const r of recap) {
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
          background: 'var(--bg-base)',
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
              {recap.map((r) => (
                <LoueurCard
                  key={r.loueur.id}
                  recap={r}
                  project={project}
                  activeVersion={activeVersion}
                  org={org}
                  onPreview={onPreview}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

// ─── Carte par loueur ──────────────────────────────────────────────────────

function LoueurCard({ recap, project, activeVersion, org, onPreview }) {
  const { loueur, lignes } = recap
  const couleur = loueur.couleur || '#64748b'
  const [generating, setGenerating] = useState(false)
  const inflightRef = useRef(false)

  async function handlePdf() {
    if (inflightRef.current) return
    if (!onPreview) return
    inflightRef.current = true
    setGenerating(true)
    try {
      const result = await exportMatosLoueurSinglePDF({
        project,
        activeVersion,
        loueur,
        lignes,
        org,
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
        border: `1px solid ${alpha(couleur, '55')}`,
      }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: alpha(couleur, '18'),
          borderBottom: `1px solid ${alpha(couleur, '44')}`,
        }}
      >
        <span
          className="inline-block rounded-full shrink-0"
          style={{
            width: '10px',
            height: '10px',
            background: couleur,
          }}
        />
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

        {/* PDF (MAT-7) */}
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
      </header>

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
                {l.designation}
                {!l.materielBddId && (
                  <span
                    className="ml-2 text-[9px] px-1 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      background: 'var(--bg-hov)',
                      color: 'var(--txt-3)',
                    }}
                    title="Désignation libre (pas dans le catalogue)"
                  >
                    libre
                  </span>
                )}
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

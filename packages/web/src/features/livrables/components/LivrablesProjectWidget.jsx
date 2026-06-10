// ════════════════════════════════════════════════════════════════════════════
// LivrablesProjectWidget — récap LIV pour la page accueil projet (LIV-17)
// ════════════════════════════════════════════════════════════════════════════
//
// Widget compact intégré dans `ProjetTab.jsx` (en remplacement du placeholder
// "Aucun livrable défini · Voir →" qui datait de l'ère pré-LIV où les
// livrables étaient stockés dans `projects.livrables_json`).
//
// Le widget fait son propre fetch via `useLivrables(projectId)` — il est
// self-contained pour pouvoir aussi vivre ailleurs (ex futur dashboard projet,
// homepage globale via une variante mode='compact'/'full').
//
// Contenu (mode 'compact', le seul implémenté pour l'instant) :
//   - Header     : titre "Livrables" + lien "Voir tout →" vers la tab
//   - Bandeau    : "Prochain" (label court) — caché si aucun à venir
//   - Compteurs  : 3 chips Total / En retard / Livrés
//   - Liste      : TOUS les livrables triés par date (en retard puis croissant,
//                  null à la fin). Affichage compact : num · nom · format ·
//                  durée · date · monteur. Pas de lien par item — le "Voir
//                  tout →" du header suffit pour naviguer.
//
// Empty state global (0 livrable) : message court + lien "Créer un livrable".
//
// Props :
//   - projectId  : string (obligatoire)
//   - className  : string optionnel (passé au container)
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  FileText,
  Plus,
} from 'lucide-react'
import { useLivrables } from '../../../hooks/useLivrables'
import { isLivrableEnRetard } from '../../../lib/livrablesHelpers'
import MonteurAvatar from './MonteurAvatar'

// ─── Helper d'affichage date ────────────────────────────────────────────────
// Sur le widget projet, on préfère la date absolue JJ/MM/AAAA — c'est plus
// précis à l'œil quand on consulte un projet (vs le relatif utilisé sur le
// header LIV où on cherche un radar rapide). Exception : le jour J reste
// "Aujourd'hui" pour rester saillant.
function formatDateProjet(dateISO, now = new Date()) {
  if (!dateISO) return ''
  const due = new Date(dateISO + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return ''
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (due.getTime() === today.getTime()) return "Aujourd'hui"
  const dd = String(due.getDate()).padStart(2, '0')
  const mm = String(due.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${due.getFullYear()}`
}

export default function LivrablesProjectWidget({ projectId, className = '' }) {
  const {
    loading,
    error,
    blocks,
    livrablesByBlock,
    compteurs,
  } = useLivrables(projectId || null)

  // Liste à plat de tous les livrables du projet.
  const allLivrables = useMemo(() => {
    if (!livrablesByBlock) return []
    const out = []
    for (const arr of livrablesByBlock.values()) out.push(...arr)
    return out
  }, [livrablesByBlock])

  // Liste TOUS les livrables triée par date_livraison croissante (les en
  // retard apparaissent donc en haut, le futur ensuite, les sans-date à la
  // fin). Tri stable secondaire sur sort_order pour les egalités de date.
  const livrablesByDate = useMemo(() => {
    if (!allLivrables.length) return []
    const arr = allLivrables.slice()
    arr.sort((a, b) => {
      const da = a?.date_livraison || ''
      const db = b?.date_livraison || ''
      // Sans-date à la fin (chaîne vide → on la pousse).
      if (!da && !db) return (a.sort_order ?? 0) - (b.sort_order ?? 0)
      if (!da) return 1
      if (!db) return -1
      const cmp = da.localeCompare(db)
      if (cmp !== 0) return cmp
      return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    })
    return arr
  }, [allLivrables])

  const totalCount = allLivrables.length
  const livrablesPath = `/projets/${projectId}/livrables`

  // ─── États dérivés ──────────────────────────────────────────────────────
  if (!projectId) return null
  if (loading) {
    return (
      <div className={`card overflow-visible ${className}`}>
        <WidgetHeader to={livrablesPath} />
        <div className="p-5 flex items-center justify-center h-24">
          <div
            className="w-5 h-5 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--green)', borderTopColor: 'transparent' }}
          />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`card overflow-visible ${className}`}>
        <WidgetHeader to={livrablesPath} />
        <div className="p-5">
          <p className="text-xs italic" style={{ color: 'var(--red)' }}>
            Erreur de chargement.
          </p>
        </div>
      </div>
    )
  }

  if (totalCount === 0) {
    return (
      <div className={`card overflow-visible ${className}`}>
        <WidgetHeader to={livrablesPath} />
        <EmptyState to={livrablesPath} hasBlocks={blocks.length > 0} />
      </div>
    )
  }

  // ─── Rendu plein ─────────────────────────────────────────────────────────
  const prochain = compteurs?.prochain || null

  return (
    <div className={`card overflow-visible ${className}`}>
      <WidgetHeader to={livrablesPath} />
      <div className="p-5 flex flex-col gap-4">
        {prochain && <ProchainBanner livrable={prochain} to={livrablesPath} />}
        <CountersRow compteurs={compteurs} />
        <LivrablesList livrables={livrablesByDate} />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// WidgetHeader — barre titre + count + lien "Voir tout →"
// ════════════════════════════════════════════════════════════════════════════

function WidgetHeader({ to }) {
  return (
    <div className="card-header">
      <div className="flex items-center gap-2">
        <CheckSquare className="w-3.5 h-3.5" style={{ color: 'var(--green)' }} />
        <h2
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--txt-2)' }}
        >
          Livrables
        </h2>
      </div>
      <Link
        to={to}
        className="text-xs font-medium transition-colors"
        style={{ color: 'var(--blue)' }}
      >
        Voir tout →
      </Link>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ProchainBanner — bandeau orange "Prochain livrable"
// ════════════════════════════════════════════════════════════════════════════

function ProchainBanner({ livrable, to }) {
  const numero = (livrable.numero || '').toString().trim()
  const nom = (livrable.nom || '').toString().trim() || 'Sans nom'
  // Séparateur point médian entre numero et nom pour éviter "2 MASTER" qui
  // se lit "2× MASTER" sur le bandeau prochain.
  const label = numero ? `${numero} · ${nom}` : nom
  const relative = formatDateProjet(livrable.date_livraison)
  const monteurName = livrable.assignee_external?.trim() || null
  return (
    <Link
      to={to}
      className="flex items-center gap-3 p-3 rounded-lg transition-colors"
      style={{
        // Bandeau allégé : pas de fond saturé, juste une bordure orange et
        // un fond très léger (var(--bg-elev)) pour que ça respire sur le
        // noir.
        background: 'var(--bg-elev)',
        border: '1px solid var(--orange)',
      }}
    >
      <ArrowRight
        className="w-4 h-4 shrink-0"
        style={{ color: 'var(--orange)' }}
      />
      <div className="flex flex-col items-start min-w-0 flex-1">
        <span
          className="text-[10px] uppercase tracking-wider leading-none"
          style={{ color: 'var(--orange)' }}
        >
          Prochain
        </span>
        <span
          className="text-sm font-semibold truncate max-w-full"
          style={{ color: 'var(--txt)' }}
        >
          {label} <span style={{ color: 'var(--orange)' }}>· {relative}</span>
        </span>
      </div>
      {monteurName && (
        <div className="flex items-center gap-1.5 shrink-0">
          <MonteurAvatar name={monteurName} size="sm" />
          <span
            className="text-xs hidden sm:inline truncate max-w-[120px]"
            style={{ color: 'var(--txt-2)' }}
          >
            {monteurName}
          </span>
        </div>
      )}
    </Link>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CountersRow — 3 chips Total / En retard / Livrés
// ════════════════════════════════════════════════════════════════════════════

function CountersRow({ compteurs }) {
  const stats = [
    {
      key: 'total',
      label: 'Total',
      value: compteurs.total,
      icon: CheckSquare,
      color: 'var(--txt-2)',
    },
    {
      key: 'retard',
      label: 'En retard',
      value: compteurs.enRetard,
      icon: AlertTriangle,
      color: compteurs.enRetard > 0 ? 'var(--red)' : 'var(--txt-3)',
    },
    {
      key: 'livres',
      label: 'Livrés',
      value: compteurs.livres,
      icon: CheckCircle2,
      color: 'var(--green)',
    },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map((s) => {
        const Icon = s.icon
        return (
          <div
            key={s.key}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
            style={{ background: 'var(--bg-elev)' }}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: s.color }} />
            <span
              className="text-sm font-bold tabular-nums"
              style={{ color: 'var(--txt)' }}
            >
              {s.value}
            </span>
            <span
              className="text-[11px] truncate"
              style={{ color: 'var(--txt-3)' }}
            >
              {s.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LivrablesList — listing compact de TOUS les livrables (LIV-17 polish)
// ════════════════════════════════════════════════════════════════════════════
//
// Une ligne par livrable, statique (pas de lien — le "Voir tout →" du header
// suffit pour aller éditer). Format compact :
//   • [num]  [Nom]                    [Format · Durée]      [Date]   [Avatar]
//
// Dot rouge si en retard. Date passée → couleur rouge. Pas de séparateur de
// section : la liste est unique, triée par date_livraison croissante.
// ════════════════════════════════════════════════════════════════════════════

function LivrablesList({ livrables }) {
  if (!livrables.length) {
    return (
      <p className="text-xs italic text-center py-2" style={{ color: 'var(--txt-3)' }}>
        Aucun livrable.
      </p>
    )
  }
  return (
    <div className="flex flex-col">
      {livrables.map((l, idx) => (
        <LivrableLine
          key={l.id}
          livrable={l}
          first={idx === 0}
        />
      ))}
    </div>
  )
}

function LivrableLine({ livrable, first }) {
  const enRetard = isLivrableEnRetard(livrable)
  const numero = (livrable.numero || '').toString().trim()
  const nom = (livrable.nom || '').toString().trim() || 'Sans nom'
  const format = (livrable.format || '').toString().trim()
  const duree = (livrable.duree || '').toString().trim()
  const specs = [format, duree].filter(Boolean).join(' · ')
  const relative = livrable.date_livraison
    ? formatDateProjet(livrable.date_livraison)
    : '—'
  const monteurName = livrable.assignee_external?.trim() || null
  return (
    <div
      className="flex items-center gap-2 px-1 py-1.5 text-xs"
      style={{
        borderTop: first ? 'none' : '1px solid var(--brd-sub)',
      }}
    >
      {/* Dot retard (slot fixe pour aligner les lignes même sans dot) */}
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: enRetard ? 'var(--red)' : 'transparent' }}
      />
      {/* N° */}
      {numero && (
        <span
          className="font-mono shrink-0 w-6 text-center"
          style={{ color: 'var(--txt-3)' }}
        >
          {numero}
        </span>
      )}
      {/* Nom */}
      <span
        className="truncate flex-1 min-w-0"
        style={{ color: 'var(--txt)' }}
      >
        {nom}
      </span>
      {/* Format · Durée */}
      {specs && (
        <span
          className="hidden sm:inline shrink-0 truncate max-w-[120px]"
          style={{ color: 'var(--txt-3)' }}
        >
          {specs}
        </span>
      )}
      {/* Date relative */}
      <span
        className="shrink-0 tabular-nums w-[78px] text-right"
        style={{ color: enRetard ? 'var(--red)' : 'var(--txt-2)' }}
      >
        {relative}
      </span>
      {/* Monteur (slot fixe pour aligner) */}
      <span className="shrink-0 w-5 flex justify-center">
        {monteurName && <MonteurAvatar name={monteurName} size="sm" />}
      </span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EmptyState — 0 livrable / 0 bloc
// ════════════════════════════════════════════════════════════════════════════

function EmptyState({ to, hasBlocks }) {
  return (
    <div className="p-5 flex flex-col items-center justify-center text-center gap-2 py-8">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: 'var(--bg-elev)' }}
      >
        <FileText className="w-5 h-5" style={{ color: 'var(--txt-3)' }} />
      </div>
      <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
        {hasBlocks ? 'Aucun livrable créé' : 'Aucun bloc de livrables'}
      </p>
      <Link
        to={to}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors mt-1"
        style={{ background: 'var(--green)', color: '#fff' }}
      >
        <Plus className="w-3.5 h-3.5" />
        {hasBlocks ? 'Ajouter un livrable' : 'Créer un bloc'}
      </Link>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// devisAuditFormat — rendu humain des entrées du journal d'audit devis (R4)
// ════════════════════════════════════════════════════════════════════════════
//
// Le trigger SQL (supabase/devis_audit.sql) stocke un diff générique
//   changes = { champ: { old, new }, ... }
// Ici on traduit ça en libellés FR lisibles : "Tarif HT : 100,00 € → 120,00 €".
// Les % du devis (tva, marge, remise_pct…) sont stockés en points de % (20 = 20 %)
// → on ne réutilise PAS fmtPct (qui suppose une fraction).
// ════════════════════════════════════════════════════════════════════════════

import { fmtEur } from './cotisations'

const STATUS_LABELS = {
  brouillon: 'Brouillon',
  envoye: 'Envoyé',
  accepte: 'Accepté',
  refuse: 'Refusé',
}

const txt = (v) => {
  if (v === null || v === undefined || v === '') return '∅'
  return String(v)
}
const eur = (v) => fmtEur(v)
const pct = (v) => `${Number(v || 0)} %`
const num = (v) => (v === null || v === undefined ? '∅' : String(Number(v)))
const bool = (labels) => (v) => (v ? labels[0] : labels[1])
const status = (v) => STATUS_LABELS[v] || txt(v)

// Config par champ : libellé + formatteur de valeur.
const FIELDS = {
  // ── ligne ──
  produit: { label: 'Produit', fmt: txt },
  description: { label: 'Description', fmt: (v) => (v ? `"${String(v).slice(0, 40)}"` : '∅') },
  regime: { label: 'Régime', fmt: txt },
  use_line: { label: 'Ligne', fmt: bool(['activée', 'désactivée']) },
  nb: { label: 'Nb', fmt: num },
  quantite: { label: 'Quantité', fmt: num },
  unite: { label: 'Unité', fmt: txt },
  tarif_ht: { label: 'Tarif HT', fmt: eur },
  cout_ht: { label: 'Coût HT', fmt: eur },
  remise_pct: { label: 'Remise', fmt: pct },
  category_id: { label: 'Bloc', fmt: txt, isCategory: true },
  // ── catégorie ──
  name: { label: 'Nom', fmt: txt },
  dans_marge: { label: 'Marge', fmt: bool(['dans marge', 'hors marge']) },
  // ── devis ──
  title: { label: 'Titre', fmt: txt },
  status: { label: 'Statut', fmt: status },
  tva_rate: { label: 'TVA', fmt: pct },
  acompte_pct: { label: 'Acompte', fmt: pct },
  marge_globale_pct: { label: 'Marge globale', fmt: pct },
  assurance_pct: { label: 'Assurance', fmt: pct },
  remise_globale_pct: { label: 'Remise globale', fmt: pct },
  remise_globale_montant: { label: 'Remise globale', fmt: eur },
  notes: { label: 'Notes', fmt: (v) => (v ? 'modifiées' : '∅') },
}

const ENTITY_LABELS = { devis: 'le devis', category: 'le bloc', line: 'la ligne' }

// Construit une liste de fragments lisibles pour un diff `changes`.
// `catNameById` (optionnel) : Map id→nom pour traduire les changements de bloc.
export function formatChanges(changes, catNameById) {
  if (!changes || typeof changes !== 'object') return []
  const out = []
  for (const [field, diff] of Object.entries(changes)) {
    const cfg = FIELDS[field]
    if (!cfg) continue
    if (cfg.isCategory && catNameById) {
      const o = catNameById.get(diff.old) || '∅'
      const n = catNameById.get(diff.new) || '∅'
      out.push({ label: cfg.label, old: o, new: n })
      continue
    }
    out.push({ label: cfg.label, old: cfg.fmt(diff.old), new: cfg.fmt(diff.new) })
  }
  return out
}

// Verbe d'action + cible pour l'en-tête d'une entrée.
export function describeEntry(entry) {
  const target =
    entry.entity_label?.trim() ||
    (entry.entity === 'line' ? 'ligne sans nom' : ENTITY_LABELS[entry.entity] || 'élément')
  if (entry.op === 'INSERT') {
    return entry.entity === 'line' ? `a ajouté la ligne « ${target} »` : `a créé le bloc « ${target} »`
  }
  if (entry.op === 'DELETE') {
    return entry.entity === 'line' ? `a supprimé la ligne « ${target} »` : `a supprimé le bloc « ${target} »`
  }
  // UPDATE
  if (entry.entity === 'devis') return `a modifié ${ENTITY_LABELS.devis}`
  if (entry.entity === 'category') return `a modifié le bloc « ${target} »`
  return `a modifié la ligne « ${target} »`
}

// Temps relatif court FR ("à l'instant", "il y a 5 min", "il y a 2 h", "hier").
export function relativeTime(iso, now = Date.now()) {
  const t = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 30) return "à l'instant"
  if (s < 60) return `il y a ${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'hier'
  if (d < 7) return `il y a ${d} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

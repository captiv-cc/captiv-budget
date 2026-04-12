/**
 * RecapPaiements — section Récap Paiements en bas du Budget Réel.
 *
 * v3 — UX compacte, liste unique :
 *   • Barre résumé en haut (personnes, fournisseurs, total dû, reste)
 *   • Liste unique : personnes puis fournisseurs, non-payés en premier
 *   • Header colonnes (Prévu / Facturé / Statut)
 *   • Lignes dépliables au clic (détail postes, TVA, payé)
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, Users, Building2 } from 'lucide-react'
import { CATS_HUMAINS, fmtEur } from '../../../lib/cotisations'
import TvaPicker from '../../../components/TvaPicker'
import { memberName, refCout } from '../utils'
import { Checkbox } from './atoms'

export default function RecapPaiements({
  lines,
  _membres,
  reel,
  reelByLine,
  membreByLine,
  fournisseurs,
  onSaveGroupTotal,
  onSaveGroupPaid,
  onSaveGroupTva,
  onSaveFournisseurGroupTotal,
  onSaveFournisseurGroupPaid,
  onSaveFournisseurGroupTva,
}) {
  const fournisseurMap = Object.fromEntries((fournisseurs || []).map((f) => [f.id, f]))

  // ─── Groupes Personnes ─────────────────────────────────────────────────────
  const personGroups = (() => {
    const groups = new Map()
    for (const line of lines) {
      if (!CATS_HUMAINS.includes(line.regime)) continue
      const m = membreByLine[line.id]
      if (!m) continue
      const key = m.contact_id ? `c:${m.contact_id}` : `n:${m.prenom}|${m.nom}`
      if (!groups.has(key)) {
        groups.set(key, { key, name: memberName(m), lineIds: [], postes: [], coutPrevus: [] })
      }
      const g = groups.get(key)
      g.lineIds.push(line.id)
      g.postes.push(line.produit || '—')
      g.coutPrevus.push(refCout(line, m))
    }
    return [...groups.values()]
  })()

  // ─── Groupes Fournisseurs ──────────────────────────────────────────────────
  const fournisseurGroups = (() => {
    const groups = new Map()
    const personLineIds = new Set(personGroups.flatMap((g) => g.lineIds))
    for (const line of lines) {
      if (personLineIds.has(line.id)) continue
      const fId = line.fournisseur_id
      if (!fId) continue
      const f = fournisseurMap[fId]
      if (!f) continue
      const cp = refCout(line, membreByLine[line.id])
      if (!groups.has(fId)) groups.set(fId, { key: fId, nom: f.nom, items: [] })
      groups
        .get(fId)
        .items.push({
          id: line.id,
          isAdditif: false,
          label: line.produit || '—',
          entry: reelByLine[line.id],
          coutPrevu: cp,
        })
    }
    for (const a of reel.filter((r) => r.is_additif && r.fournisseur?.trim())) {
      const f = a.fournisseur.trim()
      const textKey = `text:${f}`
      if (!groups.has(textKey)) groups.set(textKey, { key: textKey, nom: f, items: [] })
      groups
        .get(textKey)
        .items.push({ id: a.id, isAdditif: true, label: a.description || f, entry: a })
    }
    return [...groups.values()]
  })()

  if (personGroups.length === 0 && fournisseurGroups.length === 0) return null

  // ─── Helpers pour trier : non-payés d'abord ────────────────────────────────
  const isPersonPaid = (g) => g.lineIds.length > 0 && g.lineIds.every((id) => reelByLine[id]?.paye)
  const isFournisseurPaid = (g) => g.items.length > 0 && g.items.every((it) => it.entry?.paye)

  const sortedPersons = [...personGroups].sort((a, b) => {
    const pa = isPersonPaid(a) ? 1 : 0
    const pb = isPersonPaid(b) ? 1 : 0
    return pa - pb
  })
  const sortedFournisseurs = [...fournisseurGroups].sort((a, b) => {
    const pa = isFournisseurPaid(a) ? 1 : 0
    const pb = isFournisseurPaid(b) ? 1 : 0
    return pa - pb
  })

  // ─── Totaux résumé ─────────────────────────────────────────────────────────
  const totalDuPersonnes = personGroups.reduce((s, g) => {
    return s + g.lineIds.reduce((ss, id, i) => ss + (reelByLine[id]?.montant_ht ?? g.coutPrevus[i]), 0)
  }, 0)
  const totalPayePersonnes = personGroups.reduce((s, g) => {
    return s + g.lineIds.reduce((ss, id, i) => {
      return ss + (reelByLine[id]?.paye ? (reelByLine[id]?.montant_ht ?? g.coutPrevus[i]) : 0)
    }, 0)
  }, 0)
  const totalDuFournisseurs = fournisseurGroups.reduce(
    (s, g) => s + g.items.reduce((ss, it) => ss + (it.entry?.montant_ht || 0), 0),
    0,
  )
  const totalPayeFournisseurs = fournisseurGroups.reduce(
    (s, g) =>
      s + g.items.reduce((ss, it) => ss + (it.entry?.paye ? (it.entry?.montant_ht || 0) : 0), 0),
    0,
  )
  const totalDu = totalDuPersonnes + totalDuFournisseurs
  const totalPaye = totalPayePersonnes + totalPayeFournisseurs
  const resteRegler = totalDu - totalPaye

  const nbPaid = personGroups.filter(isPersonPaid).length + fournisseurGroups.filter(isFournisseurPaid).length
  const nbTotal = personGroups.length + fournisseurGroups.length

  // Index de la première ligne payée (pour le séparateur visuel)
  const firstPaidPersonIdx = sortedPersons.findIndex(isPersonPaid)
  const firstPaidFournisseurIdx = sortedFournisseurs.findIndex(isFournisseurPaid)

  return (
    <div className="mt-2 pb-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-4 mb-3" style={{ borderTop: '2px solid var(--brd)' }}>
        <span
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--txt-3)' }}
        >
          Récap Paiements
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--brd)' }} />
      </div>

      {/* ── Barre résumé ──────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-5 px-4 py-2.5 rounded-lg mb-4"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
      >
        <SummaryChip
          icon={<Users className="w-3 h-3" />}
          label="Personnes"
          count={personGroups.length}
          color="var(--purple)"
        />
        <SummaryChip
          icon={<Building2 className="w-3 h-3" />}
          label="Fournisseurs"
          count={fournisseurGroups.length}
          color="var(--amber)"
        />
        <span style={{ width: 1, height: 20, background: 'var(--brd)' }} />
        <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          Total dû{' '}
          <span className="font-bold tabular-nums text-xs" style={{ color: 'var(--txt)' }}>
            {fmtEur(totalDu)}
          </span>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          Payé{' '}
          <span className="font-bold tabular-nums text-xs" style={{ color: 'var(--green)' }}>
            {fmtEur(totalPaye)}
          </span>
        </div>
        {resteRegler > 0.01 && (
          <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            Reste{' '}
            <span className="font-bold tabular-nums text-xs" style={{ color: 'var(--amber)' }}>
              {fmtEur(resteRegler)}
            </span>
          </div>
        )}
        <span className="ml-auto text-[10px] tabular-nums" style={{ color: 'var(--txt-3)' }}>
          {nbPaid}/{nbTotal} payés
        </span>
      </div>

      {/* ── Tableau unique ─────────────────────────────────────────────── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}
      >
        {/* Header colonnes */}
        <div
          className="flex items-center gap-3 px-4 py-1.5"
          style={{ background: 'var(--bg-elev)', borderBottom: '1px solid var(--brd)' }}
        >
          <span style={{ width: 14 }} />
          <span className="flex-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--txt-3)' }}>
            Nom
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest tabular-nums" style={{ color: 'var(--txt-3)', minWidth: 80, textAlign: 'right' }}>
            Prévu
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest tabular-nums" style={{ color: 'var(--txt-3)', minWidth: 80, textAlign: 'right' }}>
            Facturé
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--txt-3)', minWidth: 55, textAlign: 'center' }}>
            Statut
          </span>
        </div>

        {/* Section Personnes */}
        {sortedPersons.length > 0 && (
          <>
            <SectionLabel icon={<Users className="w-3 h-3" />} label="Personnes" color="var(--purple)" />
            {sortedPersons.map((g, i) => (
              <PersonRow
                key={g.key}
                group={g}
                reelByLine={reelByLine}
                onSaveGroupTotal={onSaveGroupTotal}
                onSaveGroupPaid={onSaveGroupPaid}
                onSaveGroupTva={onSaveGroupTva}
                isPaid={isPersonPaid(g)}
                showPaidSeparator={i === firstPaidPersonIdx && i > 0}
              />
            ))}
          </>
        )}

        {/* Section Fournisseurs */}
        {sortedFournisseurs.length > 0 && (
          <>
            <SectionLabel icon={<Building2 className="w-3 h-3" />} label="Fournisseurs" color="var(--amber)" />
            {sortedFournisseurs.map((g, i) => (
              <FournisseurRow
                key={g.key}
                group={g}
                onSaveFournisseurGroupTotal={onSaveFournisseurGroupTotal}
                onSaveFournisseurGroupPaid={onSaveFournisseurGroupPaid}
                onSaveFournisseurGroupTva={onSaveFournisseurGroupTva}
                isPaid={isFournisseurPaid(g)}
                showPaidSeparator={i === firstPaidFournisseurIdx && i > 0}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Chip résumé ──────────────────────────────────────────────────────────
function SummaryChip({ icon, label, count, color }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color }}>{icon}</span>
      <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
      <span
        className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
        style={{ background: `${color}18`, color }}
      >
        {count}
      </span>
    </div>
  )
}

// ─── Séparateur de section (Personnes / Fournisseurs) ────────────────────
function SectionLabel({ icon, label, color }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5"
      style={{ background: 'var(--bg)', borderBottom: '1px solid var(--brd-sub)' }}
    >
      <span style={{ color }}>{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
        {label}
      </span>
    </div>
  )
}

// ─── Séparateur "Déjà réglés" ────────────────────────────────────────────
function PaidSeparator() {
  return (
    <div
      className="flex items-center gap-2 px-4 py-1"
      style={{ background: 'rgba(74,222,128,.04)' }}
    >
      <span style={{ flex: 1, height: 1, background: 'rgba(74,222,128,.15)' }} />
      <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--green)', opacity: 0.5 }}>
        Déjà réglés
      </span>
      <span style={{ flex: 1, height: 1, background: 'rgba(74,222,128,.15)' }} />
    </div>
  )
}

// ─── Ligne compacte Personne (dépliable) ────────────────────────────────────
function PersonRow({ group, reelByLine, onSaveGroupTotal, onSaveGroupPaid, onSaveGroupTva, isPaid, showPaidSeparator }) {
  const { name, lineIds, postes, coutPrevus } = group
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [totalVal, setTotalVal] = useState('')

  const totalPrevu = coutPrevus.reduce((s, c) => s + c, 0)
  const currentReels = lineIds.map((id, i) => reelByLine[id]?.montant_ht ?? coutPrevus[i])
  const totalReel = currentReels.reduce((s, v) => s + v, 0)
  const ecart = totalReel - totalPrevu

  const tvaRates = lineIds.map((id) => reelByLine[id]?.tva_rate).filter((v) => v != null)
  const groupTva = tvaRates.length > 0 ? tvaRates[0] : 0

  const posteCounts = postes.reduce((acc, p) => { acc[p] = (acc[p] || 0) + 1; return acc }, {})
  const uniquePostes = Object.entries(posteCounts)

  function startEdit(e) {
    e.stopPropagation()
    setTotalVal(String(Math.round(totalReel * 100) / 100))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    const v = parseFloat(totalVal)
    if (!isNaN(v)) onSaveGroupTotal(lineIds, coutPrevus, v)
    setEditing(false)
  }

  const rowOpacity = isPaid ? 0.5 : 1

  return (
    <>
      {showPaidSeparator && <PaidSeparator />}
      <div style={{ borderBottom: '1px solid var(--brd-sub)', opacity: rowOpacity }}>
        {/* Ligne compacte */}
        <div
          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
          onClick={() => setOpen((p) => !p)}
          onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,.015)' }}
          onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
          style={{ background: open ? 'rgba(255,255,255,.02)' : 'transparent' }}
        >
          <span style={{ color: 'var(--txt-3)', width: 14, flexShrink: 0 }}>
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs truncate" style={{ color: 'var(--txt)' }}>
                {name || '—'}
              </span>
              <span className="text-[9px] truncate" style={{ color: 'var(--purple)', opacity: 0.8 }}>
                {uniquePostes.map(([p, n]) => n > 1 ? `${p} ×${n}` : p).join(', ')}
              </span>
            </div>
          </div>

          {/* Prévu */}
          <span
            className="text-xs tabular-nums font-medium shrink-0"
            style={{ color: 'var(--txt-3)', minWidth: 80, textAlign: 'right' }}
          >
            {fmtEur(totalPrevu)}
          </span>

          {/* Facturé */}
          <span
            className="text-xs tabular-nums font-bold shrink-0"
            style={{
              minWidth: 80,
              textAlign: 'right',
              color: Math.abs(ecart) < 0.01 ? 'var(--txt)' : ecart > 0 ? 'var(--red)' : 'var(--green)',
            }}
          >
            {editing ? (
              <input
                ref={inputRef}
                type="number"
                value={totalVal}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTotalVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(false)
                }}
                style={{
                  width: 80,
                  textAlign: 'right',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--purple)',
                  borderRadius: 4,
                  color: 'var(--txt)',
                  padding: '1px 4px',
                  fontSize: 12,
                  fontWeight: 700,
                  outline: 'none',
                }}
                step="0.01"
              />
            ) : (
              <span onClick={startEdit} className="cursor-text" title="Modifier le total réel">
                {fmtEur(totalReel)}
              </span>
            )}
          </span>

          {/* Statut */}
          <span
            className="text-[10px] font-semibold shrink-0"
            style={{
              minWidth: 55,
              textAlign: 'center',
              color: isPaid ? 'var(--green)' : totalReel > 0.01 ? 'var(--amber)' : 'var(--txt-3)',
            }}
          >
            {isPaid ? '✓ Payé' : totalReel > 0.01 ? 'À payer' : '—'}
          </span>
        </div>

        {/* Détail déplié */}
        {open && (
          <div className="px-4 pb-3 pt-1 ml-5" style={{ borderTop: '1px solid var(--brd-sub)' }}>
            {lineIds.length > 1 && (() => {
              const seen = {}
              return (
                <div className="space-y-0.5 mb-2">
                  {lineIds.map((id, i) => {
                    const r = reelByLine[id]?.montant_ht ?? coutPrevus[i]
                    const paid = reelByLine[id]?.paye
                    const n = postes[i]
                    const total = posteCounts[n]
                    seen[n] = (seen[n] || 0) + 1
                    const label = total > 1 ? `${n} #${seen[n]}` : n
                    return (
                      <div key={id} className="flex items-center gap-2">
                        <span style={{ color: paid ? 'var(--green)' : 'var(--txt-3)', fontSize: 10, flex: 1 }}>
                          {paid ? '✓ ' : ''}{label}
                        </span>
                        <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>
                          {fmtEur(coutPrevus[i])} prévu
                        </span>
                        <span style={{ color: 'var(--txt)', fontSize: 10, fontWeight: 600, minWidth: 65, textAlign: 'right' }}>
                          {fmtEur(r)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            <div className="flex items-center justify-between gap-3 pt-2" style={{ borderTop: '1px solid var(--brd-sub)' }}>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>TVA</span>
                <TvaPicker value={groupTva} onChange={(v) => onSaveGroupTva(lineIds, v)} label={null} compact />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>Payé</span>
                <Checkbox checked={isPaid} onChange={(v) => onSaveGroupPaid(lineIds, v)} color="green" />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Ligne compacte Fournisseur (dépliable) ─────────────────────────────────
function FournisseurRow({
  group,
  onSaveFournisseurGroupTotal,
  onSaveFournisseurGroupPaid,
  onSaveFournisseurGroupTva,
  isPaid,
  showPaidSeparator,
}) {
  const { nom: fournisseur, items } = group
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [totalVal, setTotalVal] = useState('')
  const [pendingTotal, setPendingTotal] = useState(null)

  const totalReel = items.reduce((s, it) => s + (it.entry?.montant_ht || 0), 0)
  const totalPrevu = items.reduce((s, it) => s + (it.coutPrevu || 0), 0)
  const isAllAdditif = items.length > 0 && items.every((it) => it.isAdditif)

  const tvaRates = items.map((it) => it.entry?.tva_rate).filter((v) => v != null)
  const groupTva = tvaRates.length > 0 ? tvaRates[0] : 20

  const totalConfirme = items.reduce((s, it) => {
    if (!it.entry || String(it.entry.id).startsWith('__tmp_')) return s
    return s + (it.entry.montant_ht || 0)
  }, 0)

  useEffect(() => {
    if (pendingTotal !== null && totalConfirme > 0) setPendingTotal(null)
  }, [totalConfirme]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayTotal = pendingTotal !== null ? pendingTotal : totalReel

  function startEdit(e) {
    e.stopPropagation()
    setTotalVal(displayTotal > 0 ? String(Math.round(displayTotal * 100) / 100) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  function commitEdit() {
    const v = parseFloat(totalVal)
    if (!isNaN(v) && v > 0) {
      setPendingTotal(v)
      onSaveFournisseurGroupTotal(items, v)
    }
    setEditing(false)
  }

  const rowOpacity = isPaid ? 0.5 : 1

  return (
    <>
      {showPaidSeparator && <PaidSeparator />}
      <div style={{ borderBottom: '1px solid var(--brd-sub)', opacity: rowOpacity }}>
        {/* Ligne compacte */}
        <div
          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
          onClick={() => setOpen((p) => !p)}
          onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,.015)' }}
          onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
          style={{ background: open ? 'rgba(255,255,255,.02)' : 'transparent' }}
        >
          <span style={{ color: 'var(--txt-3)', width: 14, flexShrink: 0 }}>
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs truncate" style={{ color: 'var(--txt)' }}>
                {fournisseur}
              </span>
              {isAllAdditif && (
                <span
                  style={{
                    fontSize: 8,
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontWeight: 700,
                    background: 'rgba(255,87,87,.12)',
                    color: 'var(--red)',
                    textTransform: 'uppercase',
                  }}
                >
                  Additif
                </span>
              )}
              <span className="text-[9px] truncate" style={{ color: 'var(--amber)', opacity: 0.8 }}>
                {items.length} ligne{items.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Prévu */}
          <span
            className="text-xs tabular-nums font-medium shrink-0"
            style={{ color: 'var(--txt-3)', minWidth: 80, textAlign: 'right' }}
          >
            {totalPrevu > 0 ? fmtEur(totalPrevu) : '—'}
          </span>

          {/* Facturé */}
          <span
            className="text-xs tabular-nums font-bold shrink-0"
            style={{
              minWidth: 80,
              textAlign: 'right',
              color: displayTotal > 0.01
                ? (totalPrevu > 0 && displayTotal > totalPrevu ? 'var(--red)' : 'var(--txt)')
                : 'var(--txt-3)',
            }}
          >
            {editing ? (
              <input
                ref={inputRef}
                type="number"
                value={totalVal}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTotalVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                style={{
                  width: 80,
                  textAlign: 'right',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--amber)',
                  borderRadius: 4,
                  color: 'var(--txt)',
                  padding: '1px 4px',
                  fontSize: 12,
                  fontWeight: 700,
                  outline: 'none',
                }}
                step="0.01"
              />
            ) : displayTotal > 0.01 ? (
              <span onClick={startEdit} className="cursor-text" title="Modifier le montant">
                {fmtEur(displayTotal)}
              </span>
            ) : (
              <button
                onClick={startEdit}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: 'var(--amber)',
                  background: 'rgba(255,174,0,.1)',
                  border: '1px dashed rgba(255,174,0,.4)',
                  borderRadius: 4,
                  padding: '2px 8px',
                }}
              >
                Saisir
              </button>
            )}
          </span>

          {/* Statut */}
          <span
            className="text-[10px] font-semibold shrink-0"
            style={{
              minWidth: 55,
              textAlign: 'center',
              color: isPaid ? 'var(--green)' : displayTotal > 0.01 ? 'var(--amber)' : 'var(--txt-3)',
            }}
          >
            {isPaid ? '✓ Payé' : displayTotal > 0.01 ? 'À payer' : '—'}
          </span>
        </div>

        {/* Détail déplié */}
        {open && (
          <div className="px-4 pb-3 pt-1 ml-5" style={{ borderTop: '1px solid var(--brd-sub)' }}>
            {items.length > 1 && (
              <div className="space-y-0.5 mb-2">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span style={{ color: it.entry?.paye ? 'var(--green)' : 'var(--txt-3)', fontSize: 10, flex: 1 }}>
                      {it.entry?.paye ? '✓ ' : ''}
                      {it.label}
                      {it.isAdditif && <span style={{ opacity: 0.5 }}> (additif)</span>}
                    </span>
                    <span style={{ color: 'var(--txt)', fontSize: 10, fontWeight: 600, minWidth: 70, textAlign: 'right' }}>
                      {it.entry?.montant_ht ? fmtEur(it.entry.montant_ht) : <span style={{ opacity: 0.3 }}>—</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2" style={{ borderTop: '1px solid var(--brd-sub)' }}>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>TVA</span>
                <TvaPicker value={groupTva} onChange={(v) => onSaveFournisseurGroupTva(items, v)} label={null} compact />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>Payé</span>
                <Checkbox checked={isPaid} onChange={(v) => onSaveFournisseurGroupPaid(items, v)} color="green" />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

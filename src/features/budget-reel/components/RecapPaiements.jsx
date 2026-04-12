/**
 * RecapPaiements — section Récap Paiements en bas du Budget Réel.
 *
 * Regroupe les lignes du devis par personne (membres équipe humains) et par
 * fournisseur (lignes liées via devis_lines.fournisseur_id + additifs avec
 * fournisseur texte). Pour chaque groupe, affiche une carte avec :
 *   - PersonGroupCard : Prévu / Réel total éditable, Payé, TVA, détail postes
 *   - FournisseurGroupCard : Budget prévu / Montant facture, Payé, TVA, détail
 *
 * Extrait de BudgetReelTab.jsx — chantier refacto.
 */

import { useState, useEffect, useRef } from 'react'
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
  // Lignes liées à un fournisseur via devis_lines.fournisseur_id
  // + additifs avec fournisseur texte (backward compat)
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
    // Additifs avec fournisseur texte libre (non lié à la table fournisseurs)
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

  return (
    <div className="mt-2 space-y-6 pb-6">
      <div className="flex items-center gap-3 pt-4" style={{ borderTop: '2px solid var(--brd)' }}>
        <span
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--txt-3)' }}
        >
          Récap Paiements
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--brd)' }} />
      </div>

      {/* Personnes */}
      {personGroups.length > 0 && (
        <div className="space-y-3">
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--purple)' }}
          >
            Personnes
          </p>
          {personGroups.map((g) => (
            <PersonGroupCard
              key={g.key}
              group={g}
              reelByLine={reelByLine}
              onSaveGroupTotal={onSaveGroupTotal}
              onSaveGroupPaid={onSaveGroupPaid}
              onSaveGroupTva={onSaveGroupTva}
            />
          ))}
        </div>
      )}

      {/* Fournisseurs */}
      {fournisseurGroups.length > 0 && (
        <div className="space-y-3">
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--amber)' }}
          >
            Fournisseurs
          </p>
          {fournisseurGroups.map((g) => (
            <FournisseurGroupCard
              key={g.key}
              group={g}
              onSaveFournisseurGroupTotal={onSaveFournisseurGroupTotal}
              onSaveFournisseurGroupPaid={onSaveFournisseurGroupPaid}
              onSaveFournisseurGroupTva={onSaveFournisseurGroupTva}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Carte Groupe Personne ──────────────────────────────────────────────────
function PersonGroupCard({ group, reelByLine, onSaveGroupTotal, onSaveGroupPaid, onSaveGroupTva }) {
  const { name, lineIds, postes, coutPrevus } = group
  const inputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [totalVal, setTotalVal] = useState('')

  const totalPrevu = coutPrevus.reduce((s, c) => s + c, 0)
  const currentReels = lineIds.map((id, i) => reelByLine[id]?.montant_ht ?? coutPrevus[i])
  const totalReel = currentReels.reduce((s, v) => s + v, 0)
  const allPaid = lineIds.length > 0 && lineIds.every((id) => reelByLine[id]?.paye)
  const ecart = totalReel - totalPrevu

  // TVA commune au groupe : si toutes les entrées partagent le même taux on l'affiche,
  // sinon on prend la première (l'utilisateur peut la propager via le picker)
  const tvaRates = lineIds.map((id) => reelByLine[id]?.tva_rate).filter((v) => v != null)
  const groupTva = tvaRates.length > 0 ? tvaRates[0] : 0
  const tvaMixed = tvaRates.length > 1 && tvaRates.some((v) => v !== groupTva)

  // Dédoublonne les postes en comptant les occurrences (même nom de poste = ×N)
  const posteCounts = postes.reduce((acc, p) => {
    acc[p] = (acc[p] || 0) + 1
    return acc
  }, {})
  const uniquePostes = Object.entries(posteCounts) // [[name, count], …]

  function startEdit() {
    setTotalVal(String(Math.round(totalReel * 100) / 100))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    const v = parseFloat(totalVal)
    if (!isNaN(v)) onSaveGroupTotal(lineIds, coutPrevus, v)
    setEditing(false)
  }

  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}
    >
      <div className="flex items-start gap-4">
        {/* Infos */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
            {name || '—'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {uniquePostes.map(([p, n]) => (
              <span
                key={p}
                style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontWeight: 600,
                  background: 'rgba(156,95,253,.1)',
                  color: 'var(--purple)',
                }}
              >
                {p}
                {n > 1 && <span style={{ opacity: 0.7, marginLeft: 4 }}>× {n}</span>}
              </span>
            ))}
          </div>
        </div>

        {/* Chiffres */}
        <div className="flex items-center gap-5 shrink-0">
          {/* Prévu */}
          <div className="text-right">
            <p
              className="text-[9px] uppercase tracking-wide mb-0.5"
              style={{ color: 'var(--txt-3)' }}
            >
              Prévu
            </p>
            <p className="font-semibold tabular-nums text-sm" style={{ color: 'var(--amber)' }}>
              {fmtEur(totalPrevu)}
            </p>
          </div>

          {/* Réel total — cliquable pour éditer */}
          <div className="text-right">
            <p
              className="text-[9px] uppercase tracking-wide mb-0.5"
              style={{ color: 'var(--txt-3)' }}
            >
              Réel total {lineIds.length > 1 ? `(${lineIds.length} postes)` : ''}
            </p>
            {editing ? (
              <input
                ref={inputRef}
                type="number"
                value={totalVal}
                onChange={(e) => setTotalVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(false)
                }}
                style={{
                  width: 100,
                  textAlign: 'right',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--purple)',
                  borderRadius: 6,
                  color: 'var(--txt)',
                  padding: '2px 6px',
                  fontSize: 13,
                  fontWeight: 700,
                  outline: 'none',
                }}
                step="0.01"
                placeholder="0.00"
              />
            ) : (
              <p
                className="font-bold tabular-nums text-sm cursor-text"
                onClick={startEdit}
                title="Cliquer pour saisir le total réel — distribué proportionnellement"
                style={{
                  color:
                    Math.abs(ecart) < 0.01
                      ? 'var(--txt)'
                      : ecart > 0
                        ? 'var(--red)'
                        : 'var(--green)',
                }}
              >
                {fmtEur(totalReel)}
                {Math.abs(ecart) > 0.01 && (
                  <span style={{ fontSize: 9, display: 'block', opacity: 0.75 }}>
                    {ecart > 0 ? '+' : ''}
                    {fmtEur(ecart)} vs prévu
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Payé */}
          <div className="text-center">
            <p
              className="text-[9px] uppercase tracking-wide mb-1"
              style={{ color: 'var(--txt-3)' }}
            >
              Payé
            </p>
            <Checkbox
              checked={allPaid}
              onChange={(v) => onSaveGroupPaid(lineIds, v)}
              color="green"
            />
          </div>
        </div>
      </div>

      {/* Ligne TVA — propage à toutes les entrées du groupe */}
      <div
        className="mt-2 pt-2 flex items-center justify-between gap-3"
        style={{ borderTop: '1px solid var(--brd-sub)' }}
      >
        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
          TVA {tvaMixed && <span style={{ color: 'var(--amber)' }}>· mixte</span>}
        </span>
        <TvaPicker
          value={groupTva}
          onChange={(v) => onSaveGroupTva(lineIds, v)}
          label={null}
          compact
        />
      </div>

      {/* Détail par poste si plusieurs lignes — index #N quand un même poste se répète */}
      {lineIds.length > 1 &&
        (() => {
          // Indice cumulatif par nom de poste pour distinguer "Directeur de production #1 / #2"
          const seen = {}
          return (
            <div
              className="mt-2 pt-2 space-y-0.5"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              {lineIds.map((id, i) => {
                const r = reelByLine[id]?.montant_ht ?? coutPrevus[i]
                const paid = reelByLine[id]?.paye
                const name = postes[i]
                const total = posteCounts[name]
                seen[name] = (seen[name] || 0) + 1
                const label = total > 1 ? `${name} #${seen[name]}` : name
                return (
                  <div key={id} className="flex items-center gap-2">
                    <span
                      style={{
                        color: paid ? 'var(--green)' : 'var(--txt-3)',
                        fontSize: 10,
                        flex: 1,
                      }}
                    >
                      {paid ? '✓ ' : ''}
                      {label}
                    </span>
                    <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>
                      {fmtEur(coutPrevus[i])} prévu
                    </span>
                    <span
                      style={{
                        color: 'var(--txt)',
                        fontSize: 10,
                        fontWeight: 600,
                        minWidth: 65,
                        textAlign: 'right',
                      }}
                    >
                      {fmtEur(r)}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })()}
    </div>
  )
}

// ─── Carte Groupe Fournisseur ───────────────────────────────────────────────
function FournisseurGroupCard({
  group,
  onSaveFournisseurGroupTotal,
  onSaveFournisseurGroupPaid,
  onSaveFournisseurGroupTva,
}) {
  const { nom: fournisseur, items } = group // ← nom, pas key
  const inputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [totalVal, setTotalVal] = useState('')
  const [pendingTotal, setPendingTotal] = useState(null) // total optimiste local

  const totalReel = items.reduce((s, it) => s + (it.entry?.montant_ht || 0), 0)
  const totalPrevu = items.reduce((s, it) => s + (it.coutPrevu || 0), 0)
  const allPaid = items.length > 0 && items.every((it) => it.entry?.paye)
  const isAllAdditif = items.length > 0 && items.every((it) => it.isAdditif)

  // TVA commune au groupe (idem PersonGroupCard)
  const tvaRates = items.map((it) => it.entry?.tva_rate).filter((v) => v != null)
  const groupTva = tvaRates.length > 0 ? tvaRates[0] : 20
  const tvaMixed = tvaRates.length > 1 && tvaRates.some((v) => v !== groupTva)

  // Uniquement les entrées confirmées par la DB (id réel, pas temporaire)
  const totalConfirme = items.reduce((s, it) => {
    if (!it.entry || String(it.entry.id).startsWith('__tmp_')) return s
    return s + (it.entry.montant_ht || 0)
  }, 0)

  // On abandonne le pendingTotal seulement quand la DB confirme (id réel)
  useEffect(() => {
    if (pendingTotal !== null && totalConfirme > 0) setPendingTotal(null)
  }, [totalConfirme]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayTotal = pendingTotal !== null ? pendingTotal : totalReel

  function startEdit() {
    setTotalVal(displayTotal > 0 ? String(Math.round(displayTotal * 100) / 100) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  function commitEdit() {
    const v = parseFloat(totalVal)
    if (!isNaN(v) && v > 0) {
      setPendingTotal(v) // affiche immédiatement, sans attendre la DB
      onSaveFournisseurGroupTotal(items, v)
    }
    setEditing(false)
  }

  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}
    >
      <div className="flex items-start gap-4">
        {/* Infos */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
              {fournisseur}
            </p>
            {isAllAdditif && (
              <span
                style={{
                  fontSize: 9,
                  padding: '2px 7px',
                  borderRadius: 4,
                  fontWeight: 700,
                  background: 'rgba(255,87,87,.12)',
                  color: 'var(--red)',
                  letterSpacing: '.05em',
                  textTransform: 'uppercase',
                  border: '1px solid rgba(255,87,87,.3)',
                }}
              >
                Additif
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {items.map((it, i) => (
              <span
                key={i}
                style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontWeight: 600,
                  background: it.isAdditif ? 'rgba(255,87,87,.1)' : 'rgba(255,174,0,.1)',
                  color: it.isAdditif ? 'var(--red)' : 'var(--amber)',
                }}
              >
                {it.isAdditif && <span style={{ opacity: 0.75, marginRight: 3 }}>+</span>}
                {it.label}
              </span>
            ))}
          </div>
        </div>

        {/* Chiffres */}
        <div className="flex items-center gap-5 shrink-0">
          {/* Coût prévu */}
          {totalPrevu > 0 && (
            <div className="text-right">
              <p
                className="text-[9px] uppercase tracking-wide mb-0.5"
                style={{ color: 'var(--txt-3)' }}
              >
                Budget prévu
              </p>
              <p className="font-semibold tabular-nums text-sm" style={{ color: 'var(--amber)' }}>
                {fmtEur(totalPrevu)}
              </p>
            </div>
          )}

          {/* Montant facture — bouton d'édition bien visible */}
          <div className="text-right">
            <p
              className="text-[9px] uppercase tracking-wide mb-1"
              style={{ color: 'var(--txt-3)' }}
            >
              Montant facture {items.length > 1 ? `(${items.length} lignes)` : ''}
            </p>
            {editing ? (
              <input
                ref={inputRef}
                type="number"
                value={totalVal}
                onChange={(e) => setTotalVal(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                style={{
                  width: 110,
                  textAlign: 'right',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--amber)',
                  borderRadius: 6,
                  color: 'var(--txt)',
                  padding: '3px 8px',
                  fontSize: 13,
                  fontWeight: 700,
                  outline: 'none',
                }}
                step="0.01"
                placeholder="0.00"
              />
            ) : displayTotal > 0 ? (
              <p
                className="font-bold tabular-nums text-sm cursor-text"
                onClick={startEdit}
                style={{
                  color:
                    totalPrevu > 0 && Math.abs(displayTotal - totalPrevu) < 0.01
                      ? 'var(--txt)'
                      : displayTotal > totalPrevu
                        ? 'var(--red)'
                        : 'var(--green)',
                }}
              >
                {fmtEur(displayTotal)}
                {totalPrevu > 0 && Math.abs(displayTotal - totalPrevu) > 0.01 && (
                  <span style={{ fontSize: 9, display: 'block', opacity: 0.75 }}>
                    {displayTotal > totalPrevu ? '+' : ''}
                    {fmtEur(displayTotal - totalPrevu)} vs prévu
                  </span>
                )}
              </p>
            ) : (
              /* Bouton visible quand pas encore saisi */
              <button
                onClick={startEdit}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: 'var(--amber)',
                  background: 'rgba(255,174,0,.1)',
                  border: '1px dashed rgba(255,174,0,.4)',
                  borderRadius: 6,
                  padding: '3px 10px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,174,0,.2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,174,0,.1)')}
              >
                Saisir montant
              </button>
            )}
          </div>

          {/* Payé */}
          <div className="text-center">
            <p
              className="text-[9px] uppercase tracking-wide mb-1"
              style={{ color: 'var(--txt-3)' }}
            >
              Payé
            </p>
            <Checkbox
              checked={allPaid}
              onChange={(v) => onSaveFournisseurGroupPaid(items, v)}
              color="green"
            />
          </div>
        </div>
      </div>

      {/* Ligne TVA — propage à toutes les entrées du groupe */}
      <div
        className="mt-2 pt-2 flex items-center justify-between gap-3"
        style={{ borderTop: '1px solid var(--brd-sub)' }}
      >
        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
          TVA {tvaMixed && <span style={{ color: 'var(--amber)' }}>· mixte</span>}
        </span>
        <TvaPicker
          value={groupTva}
          onChange={(v) => onSaveFournisseurGroupTva(items, v)}
          label={null}
          compact
        />
      </div>

      {/* Détail par ligne si plusieurs */}
      {items.length > 1 && (
        <div className="mt-2 pt-2 space-y-0.5" style={{ borderTop: '1px solid var(--brd-sub)' }}>
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                style={{
                  color: it.entry?.paye ? 'var(--green)' : 'var(--txt-3)',
                  fontSize: 10,
                  flex: 1,
                }}
              >
                {it.entry?.paye ? '✓ ' : ''}
                {it.label}
                {it.isAdditif && <span style={{ opacity: 0.5 }}> (additif)</span>}
              </span>
              <span
                style={{
                  color: 'var(--txt)',
                  fontSize: 10,
                  fontWeight: 600,
                  minWidth: 70,
                  textAlign: 'right',
                }}
              >
                {it.entry?.montant_ht ? (
                  fmtEur(it.entry.montant_ht)
                ) : (
                  <span style={{ opacity: 0.3 }}>— en attente</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * CategoryBlock — bloc d'une catégorie (poste budgétaire) dans la table devis.
 *
 * Affiche : en-tête (numéro, label éditable, toggle marge, notes), lignes
 * (DevisLine) avec drag&drop, barre de recherche inline (BlocSearchBar),
 * footer de synthèse avec totaux/marge/charges.
 *
 * Délègue aux callbacks parents toutes les mutations (rename, delete, lines).
 *
 * Extrait de DevisEditor.jsx — chantier refacto.
 */

import { useState, useRef } from 'react'
import { ChevronDown, ChevronRight, Trash2, StickyNote } from 'lucide-react'
import { calcLine, fmtEur } from '../../../lib/cotisations'
import { CAT_ACCENT_COLORS } from '../constants'
import DevisLine from './DevisLine'
import BlocSearchBar from './BlocSearchBar'

export default function CategoryBlock({
  cat,
  info,
  num,
  collapsed,
  taux,
  bdd,
  showAnalyse,
  remiseVisible,
  onToggle,
  onRename,
  onDelete,
  onToggleDansMarge,
  onUpdateNotes,
  onAddLine,
  onAddLineDirect,
  onOpenIntermittent,
  onUpdateLine,
  onUpdateLineBatch,
  onDeleteLine,
  onDuplicateLine,
  onReorderLines,
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(info.label)
  const [showNotes, setShowNotes] = useState(Boolean(cat.notes))
  const [localNotes, setLocalNotes] = useState(cat.notes || '')
  const notesTimer = useRef(null)
  const dragIdx = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  const dansMarge = cat.dans_marge !== false
  const accentColor = info.color || CAT_ACCENT_COLORS[0]
  const displayLabel = info.isCanonical ? info.label : cat.name
  const _numLabel = num != null ? `${num} — ` : ''

  // ── Calculs agrégés de la catégorie ───────────────────────────────────────
  const activeLines = cat.lines.filter((l) => l.use_line)
  const catStats = activeLines.reduce(
    (acc, l) => {
      const c = calcLine(l, taux)
      return {
        sousTotal: acc.sousTotal + c.prixVenteHT,
        coutReel: acc.coutReel + c.coutReelHT,
        marge: acc.marge + (l.dans_marge ? c.margeHT : 0),
        charges: acc.charges + c.chargesPat,
        coutCharge: acc.coutCharge + c.coutCharge,
      }
    },
    { sousTotal: 0, coutReel: 0, marge: 0, charges: 0, coutCharge: 0 },
  )
  const pctMarge = catStats.sousTotal > 0 ? catStats.marge / catStats.sousTotal : 0

  return (
    <>
      {/* ── Séparateur haut — respiration entre blocs ────────────────────── */}
      <tr style={{ height: '40px' }}>
        <td colSpan={17} style={{ background: 'var(--bg)', padding: 0, border: 'none' }} />
      </tr>

      {/* ── En-tête catégorie — card top ─────────────────────────────────── */}
      <tr className="cat-row">
        <td
          className="px-3 py-1.5"
          colSpan={showAnalyse ? 15 : 12}
          style={{
            borderLeft: `3px solid ${accentColor}`,
            borderTop: `1px solid ${accentColor}30`,
            borderTopLeftRadius: '8px',
          }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              style={{ color: 'var(--txt-3)' }}
              className="hover:text-white transition-colors shrink-0"
            >
              {collapsed ? (
                <ChevronRight className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
            {/* Numéro de bloc */}
            {num != null && (
              <span
                className="text-[10px] font-bold tabular-nums"
                style={{ color: `${accentColor}66`, minWidth: '1rem' }}
              >
                {num}
              </span>
            )}
            {/* Nom éditable — double-clic sur les blocs libres uniquement */}
            {!info.isCanonical && editing ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  onRename(name)
                  setEditing(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur()
                  if (e.key === 'Escape') {
                    setName(cat.name)
                    setEditing(false)
                  }
                }}
                className="text-[11px] px-2 py-0.5 rounded border outline-none font-bold uppercase tracking-widest"
                style={{
                  background: 'var(--bg-elev)',
                  color: accentColor,
                  borderColor: accentColor + '50',
                  minWidth: '120px',
                }}
              />
            ) : (
              <span
                className="text-[11px] font-bold uppercase tracking-widest transition-colors"
                style={{ color: accentColor, cursor: info.isCanonical ? 'default' : 'pointer' }}
                title={info.isCanonical ? undefined : 'Double-cliquer pour renommer'}
                onDoubleClick={
                  info.isCanonical
                    ? undefined
                    : () => {
                        setName(cat.name)
                        setEditing(true)
                      }
                }
              >
                {displayLabel}
              </span>
            )}
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              {activeLines.length} ligne{activeLines.length > 1 ? 's' : ''}
            </span>
            {/* Toggle dans_marge */}
            <button
              onClick={() => onToggleDansMarge(!dansMarge)}
              title={
                dansMarge
                  ? 'Exclure du calcul de marge globale'
                  : 'Inclure dans le calcul de marge globale'
              }
              className="text-[10px] px-1.5 py-[1px] rounded-full font-medium transition-all"
              style={
                dansMarge
                  ? {
                      background: 'rgba(0,200,117,.1)',
                      color: 'rgba(0,200,117,.6)',
                      border: '1px solid rgba(0,200,117,.2)',
                    }
                  : {
                      background: 'var(--bg-elev)',
                      color: 'var(--txt-3)',
                      border: '1px solid var(--brd)',
                      textDecoration: 'line-through',
                    }
              }
            >
              {dansMarge ? 'Marge' : 'Hors marge'}
            </button>
            {/* Bouton notes */}
            <button
              onClick={() => setShowNotes((v) => !v)}
              title={showNotes ? 'Masquer les notes' : 'Afficher les notes'}
              className="transition-all"
              style={{
                color: showNotes || localNotes ? 'var(--orange)' : 'var(--txt-3)',
                opacity: showNotes || localNotes ? 1 : 0.4,
              }}
            >
              <StickyNote className="w-3 h-3" />
            </button>
            {/* Total bloc — affiché à droite */}
            <span
              className="ml-auto text-[11px] tabular-nums font-semibold pr-2"
              style={{ color: accentColor }}
            >
              {fmtEur(catStats.sousTotal)}
            </span>
          </div>
        </td>
        <td
          className="px-2 py-1.5 text-center"
          style={{
            borderTop: `1px solid ${accentColor}18`,
            borderRight: `1px solid ${accentColor}18`,
            borderTopRightRadius: '8px',
          }}
        >
          <button
            onClick={onDelete}
            className="transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </td>
      </tr>

      {!collapsed && showNotes && (
        <tr>
          <td
            colSpan={showAnalyse ? 16 : 13}
            style={{
              background: 'var(--bg-surf)',
              borderLeft: `3px solid ${accentColor}`,
              borderRight: `1px solid ${accentColor}18`,
              padding: '6px 12px',
            }}
          >
            <textarea
              value={localNotes}
              placeholder="Notes sur ce bloc…"
              rows={2}
              onChange={(e) => {
                const val = e.target.value
                setLocalNotes(val)
                clearTimeout(notesTimer.current)
                notesTimer.current = setTimeout(() => onUpdateNotes(val), 600)
              }}
              onBlur={() => {
                clearTimeout(notesTimer.current)
                onUpdateNotes(localNotes)
              }}
              className="w-full resize-none outline-none text-xs rounded px-2 py-1.5"
              style={{
                background: 'rgba(255,255,255,.04)',
                border: `1px solid ${accentColor}25`,
                color: 'var(--txt-2)',
                lineHeight: 1.5,
              }}
            />
          </td>
        </tr>
      )}

      {!collapsed &&
        cat.lines.map((line, idx) => (
          <DevisLine
            key={line.id || line._tempId}
            line={line}
            index={idx}
            taux={taux}
            bdd={bdd}
            accentColor={accentColor}
            showAnalyse={showAnalyse}
            remiseVisible={remiseVisible}
            isDragOver={dragOverIdx === idx}
            onChange={(field, val) => onUpdateLine(line.id, line._tempId, field, val)}
            onChangeBatch={(updates) => onUpdateLineBatch(line.id, line._tempId, updates)}
            onDelete={() => onDeleteLine(line.id, line._tempId)}
            onDuplicate={() => onDuplicateLine(line.id, line._tempId)}
            onDragStart={() => {
              dragIdx.current = idx
            }}
            onDragOver={() => setDragOverIdx(idx)}
            onDrop={() => {
              if (dragIdx.current !== null) onReorderLines(dragIdx.current, idx)
              dragIdx.current = null
              setDragOverIdx(null)
            }}
            onDragEnd={() => {
              dragIdx.current = null
              setDragOverIdx(null)
            }}
          />
        ))}

      {!collapsed && (
        <tr>
          <td
            colSpan={showAnalyse ? 16 : 13}
            style={{
              background: 'var(--bg-surf)',
              borderLeft: `3px solid ${accentColor}`,
              borderRight: `1px solid ${accentColor}18`,
              padding: 0,
            }}
          >
            <BlocSearchBar
              bdd={bdd}
              defaultRegime={info.defaultRegime}
              accentColor={accentColor}
              onAddDirect={onAddLineDirect}
              onOpenIntermittent={onOpenIntermittent}
              onAddFreeForm={(queryText) => onAddLine(info.defaultRegime, queryText || null)}
            />
          </td>
        </tr>
      )}

      {/* ── Footer de synthèse catégorie — card bottom ───────────────────── */}
      <tr className="bloc-footer">
        <td
          colSpan={10}
          className="px-4 py-1.5 text-[10px]"
          style={{
            color: 'var(--txt-3)',
            borderLeft: `3px solid ${accentColor}`,
            borderBottom: `1px solid ${accentColor}30`,
            borderBottomLeftRadius: '8px',
          }}
        >
          {!dansMarge && (
            <span className="italic" style={{ color: 'var(--orange)' }}>
              hors marge
            </span>
          )}
        </td>
        {/* Prix vente HT — toujours visible */}
        <td
          className="px-2 py-1 text-right text-xs tabular-nums font-bold whitespace-nowrap"
          style={{ color: 'var(--blue)', borderBottom: `1px solid ${accentColor}30` }}
        >
          {fmtEur(catStats.sousTotal)}
        </td>
        {/* Colonnes analyse — conditionnelles */}
        {showAnalyse ? (
          <>
            {/* Coût réel */}
            <td
              className="px-2 py-1 text-right text-[11px] tabular-nums whitespace-nowrap"
              style={{ color: 'var(--txt-3)', borderBottom: `1px solid ${accentColor}30` }}
            >
              {fmtEur(catStats.coutReel)}
            </td>
            {/* Marge + % fusionnés */}
            <td
              className="px-2 py-1 text-right whitespace-nowrap"
              style={{ borderBottom: `1px solid ${accentColor}30` }}
            >
              <div
                className="text-[11px] tabular-nums font-semibold"
                style={{ color: catStats.marge > 0 ? 'var(--green)' : 'var(--red)' }}
              >
                {fmtEur(catStats.marge)}
              </div>
              <div
                className="text-[10px] tabular-nums"
                style={{ color: pctMarge > 0 ? 'var(--green)' : 'var(--red)' }}
              >
                {(pctMarge * 100).toFixed(1)}%
              </div>
            </td>
            {/* Charges */}
            <td
              className="px-2 py-1 text-right text-[11px] tabular-nums whitespace-nowrap"
              style={{ color: 'var(--txt-3)', borderBottom: `1px solid ${accentColor}30` }}
            >
              {catStats.charges > 0 ? fmtEur(catStats.charges) : '—'}
            </td>
            {/* Coût chargé */}
            <td
              className="px-2 py-1 text-right text-[11px] tabular-nums whitespace-nowrap"
              style={{ color: 'var(--txt-3)', borderBottom: `1px solid ${accentColor}30` }}
            >
              {fmtEur(catStats.coutCharge)}
            </td>
          </>
        ) : (
          /* Résumé compact Mg% */
          <td
            className="px-2 py-1 text-right text-[11px] tabular-nums font-semibold whitespace-nowrap"
            style={{
              color: pctMarge >= 0 ? 'var(--green)' : 'var(--red)',
              borderBottom: `1px solid ${accentColor}30`,
            }}
          >
            {(pctMarge * 100).toFixed(1)}%
          </td>
        )}
        <td
          style={{
            borderRight: `1px solid ${accentColor}18`,
            borderBottom: `1px solid ${accentColor}30`,
            borderBottomRightRadius: '8px',
          }}
        />
      </tr>
    </>
  )
}

/**
 * FacturesTab — Gestion des factures d'un projet (multi-lots)
 *
 * Chaque facture est rattachée à un lot (contrat commercial indépendant)
 * via factures.lot_id. Quand il existe un devis de référence pour le lot,
 * on pré-remplit % et TVA à partir de lui.
 *
 * Vue :
 *   - Mono-lot : tableau plat comme avant, pas de colonne lot, 1 jauge
 *   - Multi-lot : colonne Lot + chip couleur, filtre par lot, N jauges
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { useProjet } from '../ProjetLayout'
import { useAuth } from '../../contexts/AuthContext'
import { fmtEur } from '../../lib/cotisations'
import LotScopeSelector from '../../components/LotScopeSelector'
import {
  Receipt,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  CalendarClock,
  Pencil,
  Trash2,
  X,
  Euro,
  TrendingUp,
  AlertCircle,
  Ban,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Package,
} from 'lucide-react'

// ─── Constantes ───────────────────────────────────────────────────────────────
const TYPES = [
  { key: 'acompte', label: 'Acompte initial', color: 'blue' },
  { key: 'acompte_intermediaire', label: 'Acompte intermédiaire', color: 'blue' },
  { key: 'solde', label: 'Solde final', color: 'green' },
  { key: 'globale', label: 'Facture globale', color: 'purple' },
]

// 4 statuts : planifiee → emise → reglee | annulee
// "en_retard" est DÉRIVÉ (date_echeance < today && statut === 'emise'), non stocké
const STATUTS = [
  {
    key: 'planifiee',
    label: 'Planifiée',
    icon: CalendarClock,
    color: 'var(--txt-3)',
    bg: 'var(--bg-elev)',
  },
  {
    key: 'emise',
    label: 'Émise',
    icon: Send,
    color: 'var(--blue)',
    bg: 'rgba(59,130,246,.12)',
  },
  {
    key: 'reglee',
    label: 'Réglée',
    icon: CheckCircle2,
    color: 'var(--green)',
    bg: 'rgba(0,200,117,.12)',
  },
  {
    key: 'annulee',
    label: 'Annulée',
    icon: Ban,
    color: 'var(--txt-3)',
    bg: 'var(--bg-elev)',
  },
]

const TYPE_COLORS = {
  blue: { bg: 'rgba(59,130,246,.12)', txt: 'var(--blue)' },
  green: { bg: 'rgba(0,200,117,.12)', txt: 'var(--green)' },
  purple: { bg: 'rgba(139,92,246,.12)', txt: '#a78bfa' },
}

// Palette déterministe par lot (indexé par l'ordre d'apparition dans lots[])
const LOT_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
]

function lotColor(lot, lots) {
  if (!lot) return 'var(--txt-3)'
  const idx = lots.findIndex((l) => l.id === lot.id)
  return LOT_PALETTE[((idx >= 0 ? idx : 0) + LOT_PALETTE.length) % LOT_PALETTE.length]
}

function statutMeta(key) {
  return STATUTS.find((s) => s.key === key) || STATUTS[0]
}

function typeMeta(key) {
  return TYPES.find((t) => t.key === key) || TYPES[0]
}

// Formater une date ISO en DD/MM/YYYY
function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// Calculer la date d'échéance
function dateEcheance(dateEnvoi, delai) {
  if (!dateEnvoi || !delai) return null
  const d = new Date(dateEnvoi)
  d.setDate(d.getDate() + Number(delai))
  return d.toISOString().split('T')[0]
}

// Aujourd'hui en YYYY-MM-DD
const today = () => new Date().toISOString().split('T')[0]

// Retourne true si la facture a une échéance dépassée (planifiée ou émise).
function isLate(facture) {
  if (facture.statut === 'reglee' || facture.statut === 'annulee') return false
  const ech = facture.date_echeance || dateEcheance(facture.date_envoi, facture.delai_paiement)
  if (!ech) return false
  return new Date(ech) < new Date(today())
}

// Clé de tri : 0=retard, 1=urgent(<7j), 2=émise normale, 3=planifiée, 9=réglée/annulée
function sortKey(facture) {
  if (facture.statut === 'reglee' || facture.statut === 'annulee') return 9
  if (isLate(facture)) return 0
  const ech = facture.date_echeance || dateEcheance(facture.date_envoi, facture.delai_paiement)
  if (facture.statut === 'planifiee') return 3
  if (!ech) return 2
  const diff = (new Date(ech) - new Date(today())) / (1000 * 60 * 60 * 24)
  if (diff <= 7) return 1
  return 2
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div
      className="rounded-xl p-4 flex items-center gap-3"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: color?.bg || 'var(--bg-elev)' }}
      >
        <Icon className="w-4.5 h-4.5" style={{ color: color?.txt || 'var(--txt-2)' }} />
      </div>
      <div className="min-w-0">
        <p
          className="text-[11px] uppercase tracking-wide truncate"
          style={{ color: 'var(--txt-3)' }}
        >
          {label}
        </p>
        <p className="text-base font-bold leading-tight" style={{ color: 'var(--txt)' }}>
          {value}
        </p>
        {sub && (
          <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Filter Chip ─────────────────────────────────────────────────────────────
function FilterChip({ label, count, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
      style={{
        background: active ? (color || 'var(--blue)') : 'var(--bg-surf)',
        color: active ? 'white' : color || 'var(--txt-2)',
        border: active ? '1px solid transparent' : '1px solid var(--brd-sub)',
      }}
    >
      {label}
      {count !== undefined && (
        <span
          className="text-[10px] px-1.5 py-0 rounded-full font-bold"
          style={{
            background: active ? 'rgba(255,255,255,.25)' : 'var(--bg-elev)',
            color: active ? 'white' : 'var(--txt-3)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// ─── Lot chip (coloré) ───────────────────────────────────────────────────────
function LotChip({ lot, lots, compact = false }) {
  if (!lot) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt-3)',
          border: '1px dashed var(--brd)',
        }}
        title="Facture non rattachée à un lot"
      >
        <Package className="w-2.5 h-2.5" />
        Hors lot
      </span>
    )
  }
  const color = lotColor(lot, lots)
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
      style={{ background: `${color}1f`, color }}
      title={`Lot : ${lot.title}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      {compact ? lot.title.slice(0, 12) : lot.title}
    </span>
  )
}

// ─── Statut Badge ─────────────────────────────────────────────────────────────
function StatutBadge({ statut }) {
  const meta = statutMeta(statut)
  const Icon = meta.icon
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ background: meta.bg, color: meta.color }}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  )
}

// ─── Dropdown statut via portal (évite le clipping overflow) ─────────────────
function StatutDropdown({ statut, onSelect }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.right - 160 })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return
      if (menuRef.current && menuRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <>
      <button ref={btnRef} onClick={toggle}>
        <StatutBadge statut={statut} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 9999,
              width: 160,
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,.5)',
              overflow: 'hidden',
            }}
          >
            {STATUTS.map((s) => (
              <button
                key={s.key}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                style={{ color: s.color }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                onClick={() => {
                  onSelect(s.key)
                  setOpen(false)
                }}
              >
                <s.icon className="w-3 h-3" />
                {s.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

// ─── Ligne de facture ─────────────────────────────────────────────────────────
function FactureLine({
  facture,
  lot,
  lots,
  showLotCol,
  gridCols,
  onEdit,
  onDelete,
  onChangeStatut,
  dim,
}) {
  const type = typeMeta(facture.type)
  const tc = TYPE_COLORS[type.color] || TYPE_COLORS.blue
  const ech = facture.date_echeance || dateEcheance(facture.date_envoi, facture.delai_paiement)
  const retard = isLate(facture)
  let joursRestants = null
  const actif = facture.statut === 'planifiee' || facture.statut === 'emise'
  if (ech && actif) {
    joursRestants = Math.round((new Date(ech) - new Date(today())) / (1000 * 60 * 60 * 24))
  }
  const retardLabel = facture.statut === 'planifiee' ? 'À émettre' : 'Retard'
  const retardTitle =
    facture.statut === 'planifiee'
      ? `Échéance dépassée de ${Math.abs(joursRestants || 0)} j — à émettre dans Qonto`
      : `${Math.abs(joursRestants || 0)} j de retard de règlement`

  return (
    <div
      className="grid items-center gap-3 px-4 py-3 text-sm transition-colors"
      style={{
        gridTemplateColumns: gridCols,
        borderTop: '1px solid var(--brd-sub)',
        opacity: dim ? 0.55 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      {/* Objet + type + N° Qonto */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate text-sm" style={{ color: 'var(--txt)' }}>
            {facture.objet || `Facture ${type.label}`}
          </p>
          {retard && (
            <span
              className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide inline-flex items-center gap-1"
              style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)' }}
              title={retardTitle}
            >
              <AlertCircle className="w-3 h-3" />
              {retardLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span
            className="text-[11px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: tc.bg, color: tc.txt }}
          >
            {type.label}
          </span>
          {facture.numero && (
            <span className="text-[11px] font-mono" style={{ color: 'var(--txt-3)' }}>
              {facture.numero}
            </span>
          )}
          {facture.qonto_url && (
            <a
              href={facture.qonto_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium transition-colors"
              style={{ background: 'rgba(139,92,246,.12)', color: '#a78bfa' }}
              title="Ouvrir dans Qonto"
            >
              <ExternalLink className="w-3 h-3" />
              Qonto
            </a>
          )}
        </div>
      </div>

      {/* Colonne Lot (multi-lot uniquement) */}
      {showLotCol && (
        <div className="flex items-center">
          <LotChip lot={lot} lots={lots} />
        </div>
      )}

      {/* Montant HT */}
      <div className="text-right">
        <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
          {fmtEur(facture.montant_ht)}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          HT
        </p>
      </div>

      {/* Montant TTC */}
      <div className="text-right">
        <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
          {fmtEur(facture.montant_ttc)}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          TTC
        </p>
      </div>

      {/* Échéance + jours restants */}
      <div className="text-center">
        <p className="text-xs" style={{ color: retard ? 'var(--red)' : 'var(--txt-2)' }}>
          {fmtDate(ech)}
        </p>
        {joursRestants !== null && !retard && (
          <p
            className="text-[10px]"
            style={{
              color: joursRestants <= 7 ? 'var(--amber)' : 'var(--txt-3)',
            }}
          >
            {joursRestants === 0
              ? "aujourd'hui"
              : `J${joursRestants > 0 ? '-' : '+'}${Math.abs(joursRestants)}`}
          </p>
        )}
        {joursRestants === null && (
          <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            échéance
          </p>
        )}
      </div>

      {/* Statut */}
      <div className="flex justify-center">
        <StatutDropdown
          statut={facture.statut}
          onSelect={(key) => onChangeStatut(facture.id, key)}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        <button
          onClick={() => onEdit(facture)}
          className="p-1.5 rounded-md transition-colors"
          title="Modifier"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-elev)'
            e.currentTarget.style.color = 'var(--txt)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = ''
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(facture.id)}
          className="p-1.5 rounded-md transition-colors"
          title="Supprimer"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239,68,68,.12)'
            e.currentTarget.style.color = 'var(--red)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = ''
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Modal création / édition ─────────────────────────────────────────────────
function defaultPctForType(type, acomptePct) {
  if (type === 'acompte') return acomptePct
  if (type === 'solde') return 100 - acomptePct
  if (type === 'globale') return 100
  return acomptePct
}

function FactureModal({
  open,
  onClose,
  onSave,
  facture,
  projectId,
  lots,
  activeLots,
  refDevisByLot,
  refSynthByLot,
}) {
  const [selectedLotId, setSelectedLotId] = useState(null)

  // Déduit le refDevis/refSynth du lot sélectionné
  const selectedLot = useMemo(
    () => lots.find((l) => l.id === selectedLotId) || null,
    [lots, selectedLotId],
  )
  const refDevis = selectedLotId ? refDevisByLot[selectedLotId] : null
  const refSynth = selectedLotId ? refSynthByLot[selectedLotId] : null
  const devisHT = refSynth?.totalHTFinal || 0
  const devisTTC = refSynth?.totalTTC || 0
  const acomptePctDevis = Number(refDevis?.acompte_pct) || 30
  const tvaDev = Number(refDevis?.tva_rate) || 20

  const emptyForm = {
    type: 'acompte',
    objet: '',
    numero: '',
    qonto_url: '',
    montant_ht: '',
    tva_pct: tvaDev,
    statut: 'planifiee',
    date_emission: today(),
    date_envoi: '',
    delai_paiement: 30,
    date_echeance: '',
    date_reglement: '',
    notes: '',
  }

  const [form, setForm] = useState(emptyForm)
  const [pct, setPct] = useState(acomptePctDevis)
  const [saving, setSaving] = useState(false)
  const lastEdited = useRef('pct')

  // Réinitialiser à l'ouverture
  useEffect(() => {
    if (!open) return
    // Détermination du lot par défaut :
    //  - édition : le lot de la facture (même archivé)
    //  - création : premier lot non archivé, sinon premier lot, sinon null
    let defaultLot = null
    if (facture?.lot_id) {
      defaultLot = facture.lot_id
    } else if (activeLots.length > 0) {
      defaultLot = activeLots[0].id
    } else if (lots.length > 0) {
      defaultLot = lots[0].id
    }
    setSelectedLotId(defaultLot)

    if (facture) {
      setForm({ ...emptyForm, ...facture })
      // Recalcul du % depuis le montant existant (devis de CE lot)
      const dHT = defaultLot ? refSynthByLot[defaultLot]?.totalHTFinal || 0 : 0
      const existingPct =
        dHT > 0 ? Math.round((Number(facture.montant_ht) / dHT) * 1000) / 10 : acomptePctDevis
      setPct(existingPct)
    } else {
      const initPct = defaultPctForType('acompte', acomptePctDevis)
      setPct(initPct)
      const initHT = devisHT > 0 ? Number(((devisHT * initPct) / 100).toFixed(2)) : ''
      setForm({ ...emptyForm, montant_ht: initHT, tva_pct: tvaDev })
    }
    lastEdited.current = 'pct'
  }, [open, facture]) // eslint-disable-line react-hooks/exhaustive-deps

  // Changement de lot en cours d'édition → réinitialiser % / HT / TVA si création
  function handleLotChange(newLotId) {
    setSelectedLotId(newLotId)
    if (facture) return // édition : on ne touche pas aux montants
    const newRefDevis = refDevisByLot[newLotId]
    const newRefSynth = refSynthByLot[newLotId]
    const newHT = newRefSynth?.totalHTFinal || 0
    const newAcpt = Number(newRefDevis?.acompte_pct) || 30
    const newTva = Number(newRefDevis?.tva_rate) || 20
    const suggested = defaultPctForType(form.type, newAcpt)
    setPct(suggested)
    setForm((f) => ({
      ...f,
      tva_pct: newTva,
      montant_ht: newHT > 0 ? Number(((newHT * suggested) / 100).toFixed(2)) : '',
    }))
  }

  function handleTypeChange(newType) {
    const suggested = defaultPctForType(newType, acomptePctDevis)
    setPct(suggested)
    const newHT = devisHT > 0 ? Number(((devisHT * suggested) / 100).toFixed(2)) : ''
    setForm((f) => ({ ...f, type: newType, montant_ht: newHT }))
  }

  function handlePctChange(val) {
    lastEdited.current = 'pct'
    const p = val === '' ? '' : Math.max(0, Math.min(100, Number(val)))
    setPct(p)
    if (p !== '' && devisHT > 0) {
      setForm((f) => ({ ...f, montant_ht: Number(((devisHT * p) / 100).toFixed(2)) }))
    }
  }

  function handleHTChange(val) {
    lastEdited.current = 'ht'
    setForm((f) => ({ ...f, montant_ht: val }))
    if (val !== '' && devisHT > 0) {
      const computed = Math.round((Number(val) / devisHT) * 1000) / 10
      setPct(computed)
    } else if (devisHT === 0) {
      setPct('')
    }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const montantHT = Number(form.montant_ht) || 0
  const montantTTC = montantHT * (1 + Number(form.tva_pct) / 100)

  const quickPcts = [
    { label: `${acomptePctDevis}%`, val: acomptePctDevis, hint: 'acompte devis' },
    { label: `${100 - acomptePctDevis}%`, val: 100 - acomptePctDevis, hint: 'solde' },
    { label: '50%', val: 50 },
    { label: '100%', val: 100 },
  ].filter((p, i, arr) => arr.findIndex((x) => x.val === p.val) === i)

  async function handleSave() {
    setSaving(true)
    try {
      // devis_id déduit du refDevis du lot sélectionné (null si aucun devis)
      const devisIdForLot = selectedLotId ? refDevisByLot[selectedLotId]?.id || null : null
      const payload = {
        project_id: projectId,
        lot_id: selectedLotId || null,
        devis_id: devisIdForLot,
        type: form.type,
        objet: form.objet || null,
        numero: form.numero || null,
        qonto_url: form.qonto_url || null,
        montant_ht: montantHT,
        tva_pct: Number(form.tva_pct) || 20,
        statut: form.statut,
        date_emission: form.date_emission || null,
        date_envoi: form.date_envoi || null,
        delai_paiement: Number(form.delai_paiement) || 30,
        date_echeance:
          form.date_echeance || dateEcheance(form.date_envoi, form.delai_paiement) || null,
        date_reglement: form.date_reglement || null,
        notes: form.notes || null,
      }
      await onSave(payload, facture?.id)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
    >
      <div
        className="w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd)' }}
        >
          <div className="min-w-0">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
              {facture ? 'Modifier la facture' : 'Nouvelle facture'}
            </h2>
            {devisHT > 0 && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                Devis de référence{selectedLot ? ` (${selectedLot.title})` : ''} :{' '}
                <span className="font-medium" style={{ color: 'var(--txt-2)' }}>
                  {fmtEur(devisHT)} HT
                </span>{' '}
                · <span style={{ color: 'var(--txt-2)' }}>{fmtEur(devisTTC)} TTC</span>
              </p>
            )}
            {!devisHT && selectedLot && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--amber)' }}>
                Aucun devis de référence pour « {selectedLot.title} » — saisie libre
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* ── Sélecteur de LOT (toujours visible : permet « Hors lot ») ──── */}
          <label className="block">
            <span className="text-[11px] font-medium inline-flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
              <Package className="w-3 h-3" />
              Lot
            </span>
            <select
              value={selectedLotId || ''}
              onChange={(e) => handleLotChange(e.target.value || null)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            >
              {/* Option « Hors lot » — facture sans contrat signé (acompte initial, à-valoir, ...) */}
              <option value="">— Hors lot —</option>
              {/* Lots actifs */}
              {activeLots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
              {/* Lots archivés (seulement si édition d'une facture archivée) */}
              {facture?.lot_id &&
                lots
                  .filter((l) => l.archived && l.id === facture.lot_id)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title} (archivé)
                    </option>
                  ))}
            </select>
          </label>

          {/* Type + Numéro */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
                Type *
              </span>
              <select
                value={form.type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              >
                {TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
                N° Qonto
              </span>
              <input
                type="text"
                value={form.numero}
                onChange={(e) => set('numero', e.target.value)}
                placeholder="À remplir après émission"
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
              Objet
            </span>
            <input
              type="text"
              value={form.objet}
              onChange={(e) => set('objet', e.target.value)}
              placeholder="Ex : Acompte 30% – Production vidéo institutionnelle"
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </label>

          <label className="block">
            <span
              className="text-[11px] font-medium inline-flex items-center gap-1"
              style={{ color: 'var(--txt-3)' }}
            >
              <ExternalLink className="w-3 h-3" />
              Lien Qonto
              <span className="font-normal lowercase">— optionnel</span>
            </span>
            <input
              type="url"
              value={form.qonto_url}
              onChange={(e) => set('qonto_url', e.target.value)}
              placeholder="https://app.qonto.com/…"
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </label>

          {/* ── Bloc montant — champs liés % ↔ HT ───────────────────────── */}
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--txt-3)' }}
            >
              Montant
            </p>

            {devisHT > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--txt-3)' }}>
                    % du total HT
                  </span>
                  <div className="flex gap-1 flex-wrap">
                    {quickPcts.map((q) => (
                      <button
                        key={q.val}
                        onClick={() => handlePctChange(q.val)}
                        title={q.hint}
                        className="px-2 py-0.5 rounded-md text-[11px] font-medium transition-all"
                        style={
                          Math.abs(Number(pct) - q.val) < 0.05
                            ? { background: 'var(--blue)', color: 'white' }
                            : {
                                background: 'var(--bg-surf)',
                                color: 'var(--txt-3)',
                                border: '1px solid var(--brd-sub)',
                              }
                        }
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={pct}
                      onChange={(e) => handlePctChange(e.target.value)}
                      step="1"
                      min="0"
                      max="100"
                      placeholder="0"
                      className="w-full rounded-lg pr-8 pl-3 py-2.5 text-sm font-semibold outline-none text-right"
                      style={{
                        background: 'var(--bg-surf)',
                        border: '2px solid var(--blue)',
                        color: 'var(--blue)',
                      }}
                    />
                    <span
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-bold"
                      style={{ color: 'var(--blue)' }}
                    >
                      %
                    </span>
                  </div>
                  <div className="flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
                    <span className="text-xs font-mono">↔</span>
                  </div>
                  <div className="relative flex-[2]">
                    <input
                      type="number"
                      value={form.montant_ht}
                      onChange={(e) => handleHTChange(e.target.value)}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className="w-full rounded-lg pr-8 pl-3 py-2.5 text-sm font-semibold outline-none"
                      style={{
                        background: 'var(--bg-surf)',
                        border: '1px solid var(--brd)',
                        color: 'var(--txt)',
                      }}
                    />
                    <span
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      HT
                    </span>
                  </div>
                </div>
              </div>
            )}

            {devisHT === 0 && (
              <div className="relative">
                <input
                  type="number"
                  value={form.montant_ht}
                  onChange={(e) => setForm((f) => ({ ...f, montant_ht: e.target.value }))}
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="w-full rounded-lg pr-10 pl-3 py-2.5 text-sm font-semibold outline-none"
                  style={{
                    background: 'var(--bg-surf)',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt)',
                  }}
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                  style={{ color: 'var(--txt-3)' }}
                >
                  € HT
                </span>
              </div>
            )}

            <div
              className="flex items-center gap-3 pt-1"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  TVA
                </span>
                <div className="relative">
                  <input
                    type="number"
                    value={form.tva_pct}
                    onChange={(e) => set('tva_pct', e.target.value)}
                    step="0.5"
                    min="0"
                    max="100"
                    className="w-16 text-right rounded-md px-2 py-1 text-xs outline-none"
                    style={{
                      background: 'var(--bg-surf)',
                      border: '1px solid var(--brd-sub)',
                      color: 'var(--txt-2)',
                    }}
                  />
                  <span
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    %
                  </span>
                </div>
              </div>
              <div
                className="flex-1 flex items-center justify-between rounded-lg px-3 py-1.5"
                style={{
                  background: 'rgba(59,130,246,.08)',
                  border: '1px solid rgba(59,130,246,.2)',
                }}
              >
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  Total TTC
                </span>
                <span className="text-sm font-bold" style={{ color: 'var(--blue)' }}>
                  {fmtEur(montantTTC)}
                </span>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
                Date émission
              </span>
              <input
                type="date"
                value={form.date_emission}
                onChange={(e) => set('date_emission', e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
                Date envoi
              </span>
              <input
                type="date"
                value={form.date_envoi}
                onChange={(e) => set('date_envoi', e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
                Délai paiement (j)
              </span>
              <input
                type="number"
                value={form.delai_paiement}
                onChange={(e) => set('delai_paiement', e.target.value)}
                min="0"
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
                Statut
              </span>
              <select
                value={form.statut}
                onChange={(e) => set('statut', e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              >
                {STATUTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {form.statut === 'reglee' && (
              <label className="block">
                <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
                  Date règlement
                </span>
                <input
                  type="date"
                  value={form.date_reglement}
                  onChange={(e) => set('date_reglement', e.target.value)}
                  className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt)',
                  }}
                />
              </label>
            )}
          </div>

          <label className="block">
            <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
              Notes internes
            </span>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Commentaire, condition particulière…"
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </label>
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-4"
          style={{ borderTop: '1px solid var(--brd)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.montant_ht}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{ background: 'var(--blue)' }}
          >
            {saving ? 'Enregistrement…' : facture ? 'Enregistrer' : 'Créer la facture'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Mini-jauge "reste à facturer" par lot ──────────────────────────────────
function LotFacturationGauge({ lot, lots, totalDevisHT, totalFactureHT, totalFactureTTC, totalRegle }) {
  const reste = totalDevisHT - totalFactureHT
  const pctFacture = totalDevisHT > 0 ? totalFactureHT / totalDevisHT : 0
  const pctEncaisse = totalFactureTTC > 0 ? totalRegle / totalFactureTTC : 0
  const color = lotColor(lot, lots)

  const badgeBg =
    pctFacture >= 0.999 && pctFacture <= 1.001
      ? 'rgba(0,200,117,.12)'
      : pctFacture > 1.001
        ? 'rgba(239,68,68,.12)'
        : 'rgba(59,130,246,.12)'
  const badgeCol =
    pctFacture >= 0.999 && pctFacture <= 1.001
      ? 'var(--green)'
      : pctFacture > 1.001
        ? 'var(--red)'
        : 'var(--blue)'
  const barCol =
    pctFacture >= 0.999 && pctFacture <= 1.001
      ? 'var(--green)'
      : pctFacture > 1.001
        ? 'var(--red)'
        : color

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <LotChip lot={lot} lots={lots} />
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: badgeBg, color: badgeCol }}
          >
            {(pctFacture * 100).toFixed(0)} % facturé
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span style={{ color: 'var(--txt-3)' }}>
            Facturé :{' '}
            <span className="font-semibold" style={{ color: 'var(--txt)' }}>
              {fmtEur(totalFactureHT)}
            </span>{' '}
            / {fmtEur(totalDevisHT)} HT
          </span>
          <span
            className="font-bold"
            style={{
              color:
                reste > 0.01 ? 'var(--amber)' : reste < -0.01 ? 'var(--red)' : 'var(--green)',
            }}
          >
            Reste : {fmtEur(reste)}
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, pctFacture * 100)}%`, background: barCol }}
        />
      </div>
      {totalFactureTTC > 0 && (
        <div
          className="mt-3 pt-3 flex items-center justify-between text-xs"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <span style={{ color: 'var(--txt-3)' }}>
            Encaissement :{' '}
            <span className="font-semibold" style={{ color: 'var(--txt)' }}>
              {fmtEur(totalRegle)}
            </span>{' '}
            / {fmtEur(totalFactureTTC)} TTC
          </span>
          <span
            className="font-bold"
            style={{ color: pctEncaisse >= 1 ? 'var(--green)' : 'var(--blue)' }}
          >
            {(pctEncaisse * 100).toFixed(0)} %
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function FacturesTab() {
  const { projectId, lots, refDevisByLot, refSynthByLot } = useProjet()
  const { canSeeFinance } = useAuth()

  const [factures, setFactures] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [statutFilter, setStatutFilter] = useState(null)
  // Scope unifié (identique au Dashboard / Budget Réel) :
  //   '__all__' = Agrégé (tous lots + orphelins)
  //   lotId     = un lot précis
  //   'orphans' = factures legacy sans lot_id (bucket "Hors lot")
  const [kpiScope, setKpiScope] = useState('__all__')
  const [showReglees, setShowReglees] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('factures')
      .select('*')
      .eq('project_id', projectId)
      .order('date_emission', { ascending: true })
    setFactures(data || [])
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  // ── Lots actifs / archivés ─────────────────────────────────────────────────
  const activeLots = useMemo(() => lots.filter((l) => !l.archived), [lots])
  const isMultiLot = activeLots.length > 1

  // ── Auto-reset du scope si le lot sélectionné disparaît ────────────────────
  useEffect(() => {
    if (kpiScope === '__all__' || kpiScope === 'orphans') return
    if (!activeLots.some((l) => l.id === kpiScope)) setKpiScope('__all__')
  }, [activeLots, kpiScope])

  // ── Index lot par id (inclut les archivés pour affichage des factures anciennes) ─
  const lotById = useMemo(() => {
    const m = {}
    for (const l of lots) m[l.id] = l
    return m
  }, [lots])

  // ── Factures actives (non annulées) ────────────────────────────────────────
  const facturesActives = factures.filter((f) => f.statut !== 'annulee')

  // ── Factures dans le scope (agrégé / lot / orphelins) ──────────────────────
  // Mode agrégé = strictement identique au comportement historique (tous lots + orphelins).
  const scopedFactures = useMemo(() => {
    if (kpiScope === '__all__') return facturesActives
    if (kpiScope === 'orphans') return facturesActives.filter((f) => !f.lot_id)
    return facturesActives.filter((f) => f.lot_id === kpiScope)
  }, [kpiScope, facturesActives])

  // ── KPIs — calculés sur le scope courant ──────────────────────────────────
  const totalFactureHT = scopedFactures.reduce((s, f) => s + Number(f.montant_ht), 0)
  const totalFactureTTC = scopedFactures.reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const totalRegle = scopedFactures
    .filter((f) => f.statut === 'reglee')
    .reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const totalEnAttente = scopedFactures
    .filter((f) => f.statut === 'emise')
    .reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const facturesEnRetard = scopedFactures.filter(isLate)
  const nbRetard = facturesEnRetard.length
  const pctEncaisse = totalFactureTTC > 0 ? totalRegle / totalFactureTTC : 0

  // ── Stats par lot (pour les jauges) ────────────────────────────────────────
  const statsByLot = useMemo(() => {
    const map = {}
    for (const lot of activeLots) {
      const lotFacts = facturesActives.filter((f) => f.lot_id === lot.id)
      const fHT = lotFacts.reduce((s, f) => s + Number(f.montant_ht), 0)
      const fTTC = lotFacts.reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
      const reg = lotFacts
        .filter((f) => f.statut === 'reglee')
        .reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
      map[lot.id] = {
        totalDevisHT: refSynthByLot[lot.id]?.totalHTFinal || 0,
        totalFactureHT: fHT,
        totalFactureTTC: fTTC,
        totalRegle: reg,
      }
    }
    return map
  }, [activeLots, facturesActives, refSynthByLot])

  // ── Tri + filtrage ─────────────────────────────────────────────────────────
  const matchesStatutFilter = (f) => {
    if (!statutFilter) return true
    if (statutFilter === 'retard') return isLate(f)
    return f.statut === statutFilter
  }
  // Le scope pilote le filtrage lot (agrégé = pas de filtre, sinon lot précis ou orphelins)
  const matchesScope = (f) => {
    if (kpiScope === '__all__') return true
    if (kpiScope === 'orphans') return !f.lot_id
    return f.lot_id === kpiScope
  }
  const filtered = factures.filter((f) => matchesStatutFilter(f) && matchesScope(f))
  const sorted = [...filtered].sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    if (ka !== kb) return ka - kb
    const echA = a.date_echeance || dateEcheance(a.date_envoi, a.delai_paiement) || '9999-12-31'
    const echB = b.date_echeance || dateEcheance(b.date_envoi, b.delai_paiement) || '9999-12-31'
    return echA.localeCompare(echB)
  })
  const actives = sorted.filter((f) => f.statut !== 'reglee' && f.statut !== 'annulee')
  const finales = sorted.filter((f) => f.statut === 'reglee' || f.statut === 'annulee')

  const counts = {
    all: factures.length,
    planifiee: factures.filter((f) => f.statut === 'planifiee').length,
    emise: factures.filter((f) => f.statut === 'emise').length,
    reglee: factures.filter((f) => f.statut === 'reglee').length,
    annulee: factures.filter((f) => f.statut === 'annulee').length,
    retard: nbRetard,
  }
  const countByLot = useMemo(() => {
    const m = { none: 0 }
    for (const f of factures) {
      const k = f.lot_id || 'none'
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [factures])

  // ── Détection des lots-orphelins (factures avec lot_id inconnu) ───────────
  const hasOrphans = factures.some((f) => !f.lot_id)

  // ── Grid template : une colonne de plus en multi-lot ─────────────────────
  const GRID_SINGLE = '1.6fr 110px 110px 130px 140px 80px'
  const GRID_MULTI = '1.6fr 120px 100px 100px 120px 130px 70px'
  const showLotCol = isMultiLot || hasOrphans
  const gridCols = showLotCol ? GRID_MULTI : GRID_SINGLE

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSave(payload, id) {
    if (id) {
      await supabase.from('factures').update(payload).eq('id', id)
    } else {
      await supabase.from('factures').insert(payload)
    }
    setModal(false)
    setEditing(null)
    load()
  }

  async function handleChangeStatut(id, statut) {
    const extra = statut === 'reglee' ? { date_reglement: today() } : {}
    await supabase
      .from('factures')
      .update({ statut, ...extra })
      .eq('id', id)
    setFactures((prev) => prev.map((f) => (f.id === id ? { ...f, statut, ...extra } : f)))
  }

  async function handleDelete(id) {
    if (deleting !== id) {
      setDeleting(id)
      return
    }
    await supabase.from('factures').delete().eq('id', id)
    setDeleting(null)
    setFactures((prev) => prev.filter((f) => f.id !== id))
  }

  if (!canSeeFinance)
    return (
      <div
        className="flex items-center justify-center h-64 gap-2"
        style={{ color: 'var(--txt-3)' }}
      >
        <Receipt className="w-5 h-5" />
        <p className="text-sm">Accès réservé à l&apos;équipe de production</p>
      </div>
    )

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Receipt className="w-4.5 h-4.5" style={{ color: 'var(--blue)' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Factures
            </h1>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {factures.length} facture{factures.length !== 1 ? 's' : ''}
              {isMultiLot && ` · ${activeLots.length} lots`} · suivi comptable du projet
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setEditing(null)
            setModal(true)
          }}
          disabled={activeLots.length === 0}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--blue)' }}
          title={
            activeLots.length === 0
              ? 'Créez d\'abord un lot dans l\'onglet Devis'
              : 'Nouvelle facture'
          }
        >
          <Plus className="w-4 h-4" />
          Nouvelle facture
        </button>
      </div>

      {/* ── Sélecteur de scope unifié (en tête, comme Dashboard / Budget Réel) ── */}
      {isMultiLot && factures.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <LotScopeSelector
            lotsWithRef={activeLots}
            scope={kpiScope === 'orphans' ? '__all__' : kpiScope}
            onChange={setKpiScope}
            lotColor={(lotId, ordered) => {
              const lot = ordered.find((l) => l.id === lotId)
              return lot ? lotColor(lot, lots) : 'var(--txt-3)'
            }}
          />
          {hasOrphans && (
            <FilterChip
              label="Hors lot"
              count={countByLot.none}
              active={kpiScope === 'orphans'}
              onClick={() => setKpiScope(kpiScope === 'orphans' ? '__all__' : 'orphans')}
              color="var(--txt-3)"
            />
          )}
        </div>
      )}
      {/* Mono-lot : si des orphelins existent, on laisse un chip isolé */}
      {!isMultiLot && hasOrphans && factures.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[10px] font-bold uppercase tracking-wider mr-1"
            style={{ color: 'var(--txt-3)' }}
          >
            Lot
          </span>
          <FilterChip
            label="Tous"
            count={factures.length}
            active={kpiScope === '__all__'}
            onClick={() => setKpiScope('__all__')}
          />
          <FilterChip
            label="Hors lot"
            count={countByLot.none}
            active={kpiScope === 'orphans'}
            onClick={() => setKpiScope(kpiScope === 'orphans' ? '__all__' : 'orphans')}
            color="var(--txt-3)"
          />
        </div>
      )}

      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total facturé HT"
          value={fmtEur(totalFactureHT)}
          sub={`${fmtEur(totalFactureTTC)} TTC`}
          icon={Euro}
          color={{ bg: 'rgba(59,130,246,.12)', txt: 'var(--blue)' }}
        />
        <KpiCard
          label="Encaissé"
          value={fmtEur(totalRegle)}
          sub={`${(pctEncaisse * 100).toFixed(0)} % du total`}
          icon={CheckCircle2}
          color={{ bg: 'rgba(0,200,117,.12)', txt: 'var(--green)' }}
        />
        <KpiCard
          label="En attente"
          value={fmtEur(totalEnAttente)}
          icon={Clock}
          color={{ bg: 'rgba(245,158,11,.12)', txt: 'var(--amber)' }}
        />
        <KpiCard
          label={nbRetard > 0 ? `${nbRetard} en retard` : 'Aucun retard'}
          value={
            nbRetard > 0
              ? fmtEur(facturesEnRetard.reduce((s, f) => s + Number(f.montant_ttc || 0), 0))
              : '—'
          }
          icon={nbRetard > 0 ? AlertTriangle : TrendingUp}
          color={
            nbRetard > 0
              ? { bg: 'rgba(239,68,68,.12)', txt: 'var(--red)' }
              : { bg: 'rgba(0,200,117,.08)', txt: 'var(--green)' }
          }
        />
      </div>

      {/* ── Jauges "reste à facturer" : filtrées selon le scope ─────────────── */}
      {activeLots.length > 0 && kpiScope !== 'orphans' && (
        <div className="space-y-3">
          {(kpiScope === '__all__'
            ? activeLots
            : activeLots.filter((l) => l.id === kpiScope)
          ).map((lot) => {
            const s = statsByLot[lot.id] || {
              totalDevisHT: 0,
              totalFactureHT: 0,
              totalFactureTTC: 0,
              totalRegle: 0,
            }
            // Si ce lot n'a ni devis ni factures, on masque sa jauge (rien à afficher)
            if (s.totalDevisHT === 0 && s.totalFactureHT === 0) return null
            return (
              <LotFacturationGauge
                key={lot.id}
                lot={lot}
                lots={lots}
                totalDevisHT={s.totalDevisHT}
                totalFactureHT={s.totalFactureHT}
                totalFactureTTC={s.totalFactureTTC}
                totalRegle={s.totalRegle}
              />
            )
          })}
        </div>
      )}

      {/* ── Filtres par statut ─────────────────────────────────────────────── */}
      {factures.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip
            label="Toutes"
            count={counts.all}
            active={statutFilter === null}
            onClick={() => setStatutFilter(null)}
          />
          <FilterChip
            label="Planifiées"
            count={counts.planifiee}
            active={statutFilter === 'planifiee'}
            onClick={() => setStatutFilter(statutFilter === 'planifiee' ? null : 'planifiee')}
            color="var(--txt-3)"
          />
          <FilterChip
            label="Émises"
            count={counts.emise}
            active={statutFilter === 'emise'}
            onClick={() => setStatutFilter(statutFilter === 'emise' ? null : 'emise')}
            color="var(--blue)"
          />
          {counts.retard > 0 && (
            <FilterChip
              label="En retard"
              count={counts.retard}
              active={statutFilter === 'retard'}
              onClick={() => setStatutFilter(statutFilter === 'retard' ? null : 'retard')}
              color="var(--red)"
            />
          )}
          <FilterChip
            label="Réglées"
            count={counts.reglee}
            active={statutFilter === 'reglee'}
            onClick={() => setStatutFilter(statutFilter === 'reglee' ? null : 'reglee')}
            color="var(--green)"
          />
          {counts.annulee > 0 && (
            <FilterChip
              label="Annulées"
              count={counts.annulee}
              active={statutFilter === 'annulee'}
              onClick={() => setStatutFilter(statutFilter === 'annulee' ? null : 'annulee')}
              color="var(--txt-3)"
            />
          )}
        </div>
      )}

      {/* ── Tableau ─────────────────────────────────────────────────────────── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <div
          className="grid px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            gridTemplateColumns: gridCols,
            background: 'var(--bg-elev)',
            color: 'var(--txt-3)',
            borderBottom: '1px solid var(--brd)',
          }}
        >
          <span>Facture</span>
          {showLotCol && <span>Lot</span>}
          <span className="text-right">Montant HT</span>
          <span className="text-right">Montant TTC</span>
          <span className="text-center">Échéance</span>
          <span className="text-center">Statut</span>
          <span />
        </div>

        {loading ? (
          <div
            className="flex items-center justify-center py-16 gap-2"
            style={{ color: 'var(--txt-3)' }}
          >
            <div
              className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
            />
            <span className="text-sm">Chargement…</span>
          </div>
        ) : factures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--bg-elev)' }}
            >
              <Receipt className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
              Aucune facture
            </p>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {activeLots.length === 0
                ? "Créez d'abord un lot dans l'onglet Devis"
                : 'Planifiez une facture ici avant de l\'émettre dans Qonto'}
            </p>
            {activeLots.length > 0 && (
              <button
                onClick={() => {
                  setEditing(null)
                  setModal(true)
                }}
                className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                style={{ background: 'var(--blue)' }}
              >
                <Plus className="w-3.5 h-3.5" />
                Nouvelle facture
              </button>
            )}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center py-10 gap-2">
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Aucune facture ne correspond aux filtres
            </p>
            <button
              onClick={() => {
                setStatutFilter(null)
                setKpiScope('__all__')
              }}
              className="text-xs px-2 py-0.5 rounded-md"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            >
              Réinitialiser
            </button>
          </div>
        ) : (
          <>
            {actives.map((f) => (
              <FactureLine
                key={f.id}
                facture={f}
                lot={f.lot_id ? lotById[f.lot_id] : null}
                lots={lots}
                showLotCol={showLotCol}
                gridCols={gridCols}
                onEdit={(fac) => {
                  setEditing(fac)
                  setModal(true)
                }}
                onDelete={handleDelete}
                onChangeStatut={handleChangeStatut}
              />
            ))}

            {finales.length > 0 && (
              <>
                <button
                  onClick={() => setShowReglees((v) => !v)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-[11px] font-medium transition-colors"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt-3)',
                    borderTop: '1px solid var(--brd-sub)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
                >
                  {showReglees ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                  <span className="uppercase tracking-wide">
                    Factures finalisées · {finales.length}
                  </span>
                  <span className="ml-auto" style={{ color: 'var(--txt-3)' }}>
                    {showReglees ? 'Masquer' : 'Afficher'}
                  </span>
                </button>
                {showReglees &&
                  finales.map((f) => (
                    <FactureLine
                      key={f.id}
                      facture={f}
                      lot={f.lot_id ? lotById[f.lot_id] : null}
                      lots={lots}
                      showLotCol={showLotCol}
                      gridCols={gridCols}
                      dim
                      onEdit={(fac) => {
                        setEditing(fac)
                        setModal(true)
                      }}
                      onDelete={handleDelete}
                      onChangeStatut={handleChangeStatut}
                    />
                  ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Confirmation suppression */}
      {deleting && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.5)' }}
        >
          <div
            className="rounded-xl p-5 w-80 shadow-xl"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
          >
            <p className="font-semibold text-sm mb-1" style={{ color: 'var(--txt)' }}>
              Supprimer cette facture ?
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--txt-3)' }}>
              Cette action est irréversible.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleting(null)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleting)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                style={{ background: 'var(--red)' }}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      <FactureModal
        open={modal}
        onClose={() => {
          setModal(false)
          setEditing(null)
        }}
        onSave={handleSave}
        facture={editing}
        projectId={projectId}
        lots={lots}
        activeLots={activeLots}
        refDevisByLot={refDevisByLot}
        refSynthByLot={refSynthByLot}
      />
    </div>
  )
}

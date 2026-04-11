/**
 * FacturesTab — Gestion des factures d'un projet
 * Création / édition / suivi du statut de paiement
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { useProjet } from '../ProjetLayout'
import { useAuth } from '../../contexts/AuthContext'
import { fmtEur } from '../../lib/cotisations'
import {
  Receipt, Plus, CheckCircle2, Clock, AlertTriangle,
  Send, FileText, Pencil, Trash2, X, Euro, TrendingUp, AlertCircle,
} from 'lucide-react'

// ─── Constantes ───────────────────────────────────────────────────────────────
const TYPES = [
  { key: 'acompte',               label: 'Acompte initial',          color: 'blue'   },
  { key: 'acompte_intermediaire', label: 'Acompte intermédiaire',    color: 'blue'   },
  { key: 'solde',                 label: 'Solde final',              color: 'green'  },
  { key: 'globale',               label: 'Facture globale',          color: 'purple' },
]

const STATUTS = [
  { key: 'brouillon',   label: 'Brouillon',    icon: FileText,      color: 'var(--txt-3)',  bg: 'var(--bg-elev)'            },
  { key: 'envoyee',     label: 'Envoyée',      icon: Send,          color: 'var(--blue)',   bg: 'rgba(59,130,246,.12)'      },
  { key: 'en_attente',  label: 'En attente',   icon: Clock,         color: 'var(--amber)',  bg: 'rgba(245,158,11,.12)'      },
  { key: 'reglee',      label: 'Réglée ✓',     icon: CheckCircle2,  color: 'var(--green)',  bg: 'rgba(0,200,117,.12)'       },
  { key: 'en_retard',   label: 'En retard',    icon: AlertTriangle, color: 'var(--red)',    bg: 'rgba(239,68,68,.12)'       },
]

const TYPE_COLORS = {
  blue:   { bg: 'rgba(59,130,246,.12)',  txt: 'var(--blue)'  },
  green:  { bg: 'rgba(0,200,117,.12)',   txt: 'var(--green)' },
  purple: { bg: 'rgba(139,92,246,.12)',  txt: '#a78bfa'      },
}

function statutMeta(key) {
  return STATUTS.find(s => s.key === key) || STATUTS[0]
}

function typeMeta(key) {
  return TYPES.find(t => t.key === key) || TYPES[0]
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

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: color?.bg || 'var(--bg-elev)' }}>
        <Icon className="w-4.5 h-4.5" style={{ color: color?.txt || 'var(--txt-2)' }} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide truncate" style={{ color: 'var(--txt-3)' }}>{label}</p>
        <p className="text-base font-bold leading-tight" style={{ color: 'var(--txt)' }}>{value}</p>
        {sub && <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>{sub}</p>}
      </div>
    </div>
  )
}

// ─── Statut Badge ─────────────────────────────────────────────────────────────
function StatutBadge({ statut }) {
  const meta = statutMeta(statut)
  const Icon = meta.icon
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ background: meta.bg, color: meta.color }}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  )
}

// ─── Dropdown statut via portal (évite le clipping overflow) ─────────────────
function StatutDropdown({ statut, onSelect }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.right - 160 })
    }
    setOpen(v => !v)
  }

  // Fermer si clic extérieur
  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <>
      <button ref={btnRef} onClick={toggle}>
        <StatutBadge statut={statut} />
      </button>
      {open && createPortal(
        <div
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
          }}>
          {STATUTS.map(s => (
            <button key={s.key}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
              style={{ color: s.color }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elev)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
              onClick={() => { onSelect(s.key); setOpen(false) }}>
              <s.icon className="w-3 h-3" />
              {s.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Ligne de facture ─────────────────────────────────────────────────────────
function FactureLine({ facture, onEdit, onDelete, onChangeStatut }) {
  const type   = typeMeta(facture.type)
  const tc     = TYPE_COLORS[type.color] || TYPE_COLORS.blue
  const ech    = facture.date_echeance || dateEcheance(facture.date_envoi, facture.delai_paiement)
  const retard = ech && facture.statut !== 'reglee' && new Date(ech) < new Date()

  return (
    <div className="grid items-center gap-3 px-4 py-3 text-sm transition-colors"
      style={{
        gridTemplateColumns: '1.4fr 100px 110px 110px 110px 110px 80px',
        borderTop: '1px solid var(--brd-sub)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elev)'}
      onMouseLeave={e => e.currentTarget.style.background = ''}
    >
      {/* Objet + type */}
      <div className="min-w-0">
        <p className="font-medium truncate text-sm" style={{ color: 'var(--txt)' }}>
          {facture.objet || `Facture ${type.label}`}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: tc.bg, color: tc.txt }}>
            {type.label}
          </span>
          {facture.numero && (
            <span className="text-[11px] font-mono" style={{ color: 'var(--txt-3)' }}>
              {facture.numero}
            </span>
          )}
        </div>
      </div>

      {/* Montant HT */}
      <div className="text-right">
        <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>{fmtEur(facture.montant_ht)}</p>
        <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>HT</p>
      </div>

      {/* Montant TTC */}
      <div className="text-right">
        <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>{fmtEur(facture.montant_ttc)}</p>
        <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>TTC</p>
      </div>

      {/* Émission */}
      <div className="text-center">
        <p className="text-xs" style={{ color: 'var(--txt-2)' }}>{fmtDate(facture.date_emission)}</p>
        <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>émission</p>
      </div>

      {/* Échéance */}
      <div className="text-center">
        <p className="text-xs" style={{ color: retard ? 'var(--red)' : 'var(--txt-2)' }}>
          {fmtDate(ech)}
          {retard && <AlertCircle className="w-3 h-3 inline ml-1" />}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>échéance</p>
      </div>

      {/* Statut */}
      <div className="flex justify-center">
        <StatutDropdown
          statut={facture.statut}
          onSelect={key => onChangeStatut(facture.id, key)}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        <button onClick={() => onEdit(facture)}
          className="p-1.5 rounded-md transition-colors"
          title="Modifier"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elev)'; e.currentTarget.style.color = 'var(--txt)' }}
          onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--txt-3)' }}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(facture.id)}
          className="p-1.5 rounded-md transition-colors"
          title="Supprimer"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,.12)'; e.currentTarget.style.color = 'var(--red)' }}
          onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--txt-3)' }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Modal création / édition ─────────────────────────────────────────────────
// Pourcentages suggérés par type
function defaultPctForType(type, acomptePct) {
  if (type === 'acompte')               return acomptePct
  if (type === 'solde')                 return 100 - acomptePct
  if (type === 'globale')               return 100
  return acomptePct // acompte_intermediaire : garder la valeur courante
}

function FactureModal({ open, onClose, onSave, facture, projectId, refSynth, refDevis }) {
  const devisHT    = refSynth?.totalHTFinal || 0
  const devisTTC   = refSynth?.totalTTC     || 0
  const acomptePctDevis = Number(refDevis?.acompte_pct) || 30
  const tvaDev     = Number(refDevis?.tva_rate) || 20

  const emptyForm = {
    type: 'acompte',
    objet: '',
    numero: '',
    montant_ht: '',
    tva_pct: tvaDev,
    statut: 'brouillon',
    date_emission: today(),
    date_envoi: '',
    delai_paiement: 30,
    date_echeance: '',
    date_reglement: '',
    notes: '',
  }

  const [form,   setForm]   = useState(emptyForm)
  const [pct,    setPct]    = useState(acomptePctDevis)  // % du total devis HT
  const [saving, setSaving] = useState(false)
  // Indique si la dernière modif vient du champ % ou du champ €
  const lastEdited = useRef('pct')

  // Réinitialiser à l'ouverture
  useEffect(() => {
    if (!open) return
    if (facture) {
      setForm({ ...emptyForm, ...facture })
      // Recalculer le % depuis le montant existant
      const existingPct = devisHT > 0
        ? Math.round((Number(facture.montant_ht) / devisHT) * 1000) / 10
        : acomptePctDevis
      setPct(existingPct)
    } else {
      const initPct = defaultPctForType('acompte', acomptePctDevis)
      setPct(initPct)
      const initHT  = devisHT > 0 ? +(devisHT * initPct / 100).toFixed(2) : ''
      setForm({ ...emptyForm, montant_ht: initHT, tva_pct: tvaDev })
    }
    lastEdited.current = 'pct'
  }, [open, facture]) // eslint-disable-line react-hooks/exhaustive-deps

  // Quand le type change → suggérer le bon %
  function handleTypeChange(newType) {
    const suggested = defaultPctForType(newType, acomptePctDevis)
    setPct(suggested)
    const newHT = devisHT > 0 ? +(devisHT * suggested / 100).toFixed(2) : ''
    setForm(f => ({ ...f, type: newType, montant_ht: newHT }))
  }

  // Champ % modifié → recalcule HT
  function handlePctChange(val) {
    lastEdited.current = 'pct'
    const p = val === '' ? '' : Math.max(0, Math.min(100, Number(val)))
    setPct(p)
    if (p !== '' && devisHT > 0) {
      setForm(f => ({ ...f, montant_ht: +(devisHT * p / 100).toFixed(2) }))
    }
  }

  // Champ HT modifié → recalcule %
  function handleHTChange(val) {
    lastEdited.current = 'ht'
    setForm(f => ({ ...f, montant_ht: val }))
    if (val !== '' && devisHT > 0) {
      const computed = Math.round((Number(val) / devisHT) * 1000) / 10
      setPct(computed)
    } else if (devisHT === 0) {
      setPct('')
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const montantHT  = Number(form.montant_ht) || 0
  const montantTTC = montantHT * (1 + Number(form.tva_pct) / 100)

  // Boutons de % rapides
  const quickPcts = [
    { label: `${acomptePctDevis}%`, val: acomptePctDevis, hint: 'acompte devis' },
    { label: `${100 - acomptePctDevis}%`, val: 100 - acomptePctDevis, hint: 'solde' },
    { label: '50%', val: 50 },
    { label: '100%', val: 100 },
  ].filter((p, i, arr) => arr.findIndex(x => x.val === p.val) === i) // dédoublons

  async function handleSave() {
    setSaving(true)
    try {
      const payload = {
        project_id:       projectId,
        type:             form.type,
        objet:            form.objet || null,
        numero:           form.numero || null,
        montant_ht:       montantHT,
        tva_pct:          Number(form.tva_pct) || 20,
        statut:           form.statut,
        date_emission:    form.date_emission || null,
        date_envoi:       form.date_envoi || null,
        delai_paiement:   Number(form.delai_paiement) || 30,
        date_echeance:    form.date_echeance || dateEcheance(form.date_envoi, form.delai_paiement) || null,
        date_reglement:   form.date_reglement || null,
        notes:            form.notes || null,
      }
      await onSave(payload, facture?.id)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}>
      <div className="w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd)' }}>
          <div>
            <h2 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
              {facture ? 'Modifier la facture' : 'Nouvelle facture'}
            </h2>
            {devisHT > 0 && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                Devis de référence : <span className="font-medium" style={{ color: 'var(--txt-2)' }}>{fmtEur(devisHT)} HT</span>
                {' '}· <span style={{ color: 'var(--txt-2)' }}>{fmtEur(devisTTC)} TTC</span>
              </p>
            )}
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elev)'}
            onMouseLeave={e => e.currentTarget.style.background = ''}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Type + Numéro */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Type *</span>
              <select value={form.type} onChange={e => handleTypeChange(e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}>
                {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Numéro</span>
              <input type="text" value={form.numero} onChange={e => set('numero', e.target.value)}
                placeholder="FAC-2026-001"
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }} />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Objet</span>
            <input type="text" value={form.objet} onChange={e => set('objet', e.target.value)}
              placeholder="Ex : Acompte 30% – Production vidéo institutionnelle"
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }} />
          </label>

          {/* ── Bloc montant — champs liés % ↔ HT ───────────────────────── */}
          <div className="rounded-xl p-4 space-y-3"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
              Montant
            </p>

            {/* % du devis + boutons rapides */}
            {devisHT > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--txt-3)' }}>% du total HT</span>
                  <div className="flex gap-1 flex-wrap">
                    {quickPcts.map(q => (
                      <button key={q.val}
                        onClick={() => handlePctChange(q.val)}
                        title={q.hint}
                        className="px-2 py-0.5 rounded-md text-[11px] font-medium transition-all"
                        style={Math.abs(Number(pct) - q.val) < 0.05
                          ? { background: 'var(--blue)', color: 'white' }
                          : { background: 'var(--bg-surf)', color: 'var(--txt-3)', border: '1px solid var(--brd-sub)' }}>
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input % et input HT côte à côte + flèche lien */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number" value={pct} onChange={e => handlePctChange(e.target.value)}
                      step="1" min="0" max="100" placeholder="0"
                      className="w-full rounded-lg pr-8 pl-3 py-2.5 text-sm font-semibold outline-none text-right"
                      style={{ background: 'var(--bg-surf)', border: '2px solid var(--blue)', color: 'var(--blue)' }}
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-bold"
                      style={{ color: 'var(--blue)' }}>%</span>
                  </div>
                  <div className="flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
                    <span className="text-xs font-mono">↔</span>
                  </div>
                  <div className="relative flex-[2]">
                    <input
                      type="number" value={form.montant_ht} onChange={e => handleHTChange(e.target.value)}
                      step="0.01" min="0" placeholder="0.00"
                      className="w-full rounded-lg pr-8 pl-3 py-2.5 text-sm font-semibold outline-none"
                      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium"
                      style={{ color: 'var(--txt-3)' }}>HT</span>
                  </div>
                </div>
              </div>
            )}

            {/* Sans devis de référence : saisie directe */}
            {devisHT === 0 && (
              <div className="relative">
                <input type="number" value={form.montant_ht} onChange={e => setForm(f => ({ ...f, montant_ht: e.target.value }))}
                  step="0.01" min="0" placeholder="0.00"
                  className="w-full rounded-lg pr-10 pl-3 py-2.5 text-sm font-semibold outline-none"
                  style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--txt-3)' }}>€ HT</span>
              </div>
            )}

            {/* TVA + Total TTC */}
            <div className="flex items-center gap-3 pt-1" style={{ borderTop: '1px solid var(--brd-sub)' }}>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>TVA</span>
                <div className="relative">
                  <input type="number" value={form.tva_pct} onChange={e => set('tva_pct', e.target.value)}
                    step="0.5" min="0" max="100"
                    className="w-16 text-right rounded-md px-2 py-1 text-xs outline-none"
                    style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)', color: 'var(--txt-2)' }}
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: 'var(--txt-3)' }}>%</span>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-between rounded-lg px-3 py-1.5"
                style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)' }}>
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>Total TTC</span>
                <span className="text-sm font-bold" style={{ color: 'var(--blue)' }}>{fmtEur(montantTTC)}</span>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Date émission</span>
              <input type="date" value={form.date_emission} onChange={e => set('date_emission', e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Date envoi</span>
              <input type="date" value={form.date_envoi} onChange={e => set('date_envoi', e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Délai paiement (j)</span>
              <input type="number" value={form.delai_paiement} onChange={e => set('delai_paiement', e.target.value)}
                min="0"
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Statut</span>
              <select value={form.statut} onChange={e => set('statut', e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}>
                {STATUTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            {form.statut === 'reglee' && (
              <label className="block">
                <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Date règlement</span>
                <input type="date" value={form.date_reglement} onChange={e => set('date_reglement', e.target.value)}
                  className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }} />
              </label>
            )}
          </div>

          <label className="block">
            <span className="text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>Notes internes</span>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="Commentaire, condition particulière…"
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
              style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }} />
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4"
          style={{ borderTop: '1px solid var(--brd)' }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elev)'}>
            Annuler
          </button>
          <button onClick={handleSave} disabled={saving || !form.montant_ht}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{ background: 'var(--blue)' }}>
            {saving ? 'Enregistrement…' : facture ? 'Enregistrer' : 'Créer la facture'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function FacturesTab() {
  const { projectId, refSynth, refDevis } = useProjet()
  const { canSeeFinance } = useAuth()

  const [factures, setFactures] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [deleting, setDeleting] = useState(null)

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

  useEffect(() => { load() }, [load])

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const totalFactureHT  = factures.reduce((s, f) => s + Number(f.montant_ht),  0)
  const totalFactureTTC = factures.reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const totalRegle      = factures.filter(f => f.statut === 'reglee').reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const totalEnAttente  = factures.filter(f => ['envoyee','en_attente','en_retard'].includes(f.statut)).reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const nbRetard        = factures.filter(f => f.statut === 'en_retard').length
  const pctEncaisse     = totalFactureTTC > 0 ? totalRegle / totalFactureTTC : 0

  // ── Handlers ──────────────────────────────────────────────────────────────────
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
    await supabase.from('factures').update({ statut, ...extra }).eq('id', id)
    setFactures(prev => prev.map(f => f.id === id ? { ...f, statut, ...extra } : f))
  }

  async function handleDelete(id) {
    if (deleting !== id) { setDeleting(id); return }
    await supabase.from('factures').delete().eq('id', id)
    setDeleting(null)
    setFactures(prev => prev.filter(f => f.id !== id))
  }

  if (!canSeeFinance) return (
    <div className="flex items-center justify-center h-64 gap-2" style={{ color: 'var(--txt-3)' }}>
      <Receipt className="w-5 h-5" />
      <p className="text-sm">Accès réservé à l'équipe de production</p>
    </div>
  )

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(59,130,246,.12)' }}>
            <Receipt className="w-4.5 h-4.5" style={{ color: 'var(--blue)' }} />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--txt)' }}>Factures</h1>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {factures.length} facture{factures.length !== 1 ? 's' : ''} · suivi comptable du projet
            </p>
          </div>
        </div>
        <button onClick={() => { setEditing(null); setModal(true) }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--blue)' }}>
          <Plus className="w-4 h-4" />
          Nouvelle facture
        </button>
      </div>

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
          value={nbRetard > 0 ? fmtEur(factures.filter(f=>f.statut==='en_retard').reduce((s,f)=>s+Number(f.montant_ttc||0),0)) : '—'}
          icon={nbRetard > 0 ? AlertTriangle : TrendingUp}
          color={nbRetard > 0
            ? { bg: 'rgba(239,68,68,.12)', txt: 'var(--red)' }
            : { bg: 'rgba(0,200,117,.08)', txt: 'var(--green)' }}
        />
      </div>

      {/* ── Barre de progression encaissement ──────────────────────────────── */}
      {totalFactureTTC > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--txt-2)' }}>Progression encaissement</span>
            <span className="text-xs font-bold" style={{ color: 'var(--txt)' }}>
              {fmtEur(totalRegle)} / {fmtEur(totalFactureTTC)}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, pctEncaisse * 100)}%`,
                background: pctEncaisse >= 1 ? 'var(--green)' : 'var(--blue)',
              }} />
          </div>
        </div>
      )}

      {/* ── Tableau ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>

        {/* En-tête */}
        <div className="grid px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            gridTemplateColumns: '1.4fr 100px 110px 110px 110px 110px 80px',
            background: 'var(--bg-elev)',
            color: 'var(--txt-3)',
            borderBottom: '1px solid var(--brd)',
          }}>
          <span>Facture</span>
          <span className="text-right">Montant HT</span>
          <span className="text-right">Montant TTC</span>
          <span className="text-center">Émission</span>
          <span className="text-center">Échéance</span>
          <span className="text-center">Statut</span>
          <span />
        </div>

        {/* Lignes */}
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--txt-3)' }}>
            <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }} />
            <span className="text-sm">Chargement…</span>
          </div>
        ) : factures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--bg-elev)' }}>
              <Receipt className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>Aucune facture</p>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Créez votre première facture{refSynth ? ' ou utilisez les raccourcis depuis le devis' : ''}
            </p>
            <button onClick={() => { setEditing(null); setModal(true) }}
              className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
              style={{ background: 'var(--blue)' }}>
              <Plus className="w-3.5 h-3.5" />
              Nouvelle facture
            </button>
          </div>
        ) : (
          factures.map(f => (
            <FactureLine
              key={f.id}
              facture={f}
              onEdit={fac => { setEditing(fac); setModal(true) }}
              onDelete={handleDelete}
              onChangeStatut={handleChangeStatut}
            />
          ))
        )}
      </div>

      {/* Confirmation suppression */}
      {deleting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="rounded-xl p-5 w-80 shadow-xl"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>
            <p className="font-semibold text-sm mb-1" style={{ color: 'var(--txt)' }}>Supprimer cette facture ?</p>
            <p className="text-xs mb-4" style={{ color: 'var(--txt-3)' }}>Cette action est irréversible.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleting(null)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}>
                Annuler
              </button>
              <button onClick={() => handleDelete(deleting)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                style={{ background: 'var(--red)' }}>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      <FactureModal
        open={modal}
        onClose={() => { setModal(false); setEditing(null) }}
        onSave={handleSave}
        facture={editing}
        projectId={projectId}
        refSynth={refSynth}
        refDevis={refDevis}
      />
    </div>
  )
}

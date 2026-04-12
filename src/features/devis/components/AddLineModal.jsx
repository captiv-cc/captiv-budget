/**
 * AddLineModal — modale "régime-first" pour l'ajout d'une ligne au devis.
 *
 * Étape 1 (regime) : choix du régime de la prestation.
 * Étape 2a (intermittent) : grille CCPA — type d'œuvre, poste, unité,
 *                            montant brut chargé depuis minimas_convention.
 * Étape 2b (other) : saisie libre — produit, description, quantité, tarif.
 *
 * Peut être pré-remplie via prefilledPoste / prefilledIsSpec / prefilledProduit
 * (utilisé par BlocSearchBar).
 *
 * Extrait de DevisEditor.jsx — chantier refacto.
 */

import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { UNITES } from '../../../lib/cotisations'

export const REGIMES_LIST = [
  {
    key: 'Intermittent Technicien',
    label: 'Intermittent Technicien',
    color: 'var(--purple)',
    bg: 'rgba(156,95,253,.12)',
    desc: 'CDDU — Grille CCPA',
  },
  {
    key: 'Intermittent Artiste',
    label: 'Intermittent Artiste',
    color: 'var(--purple)',
    bg: 'rgba(156,95,253,.12)',
    desc: 'CDDU — Grille CCPA',
  },
  {
    key: 'Ext. Intermittent',
    label: 'Ext. Intermittent',
    color: 'var(--violet, #7c3aed)',
    bg: 'rgba(124,58,237,.10)',
    desc: 'Vendu en Externe · Recruté en intermittent · Coût = salaire brut',
  },
  {
    key: 'Externe',
    label: 'Externe',
    color: 'var(--blue)',
    bg: 'rgba(0,122,255,.10)',
    desc: 'Prestataire externe',
  },
  {
    key: 'Interne',
    label: 'Interne',
    color: 'var(--green)',
    bg: 'rgba(0,200,117,.10)',
    desc: 'Ressource interne',
  },
  {
    key: 'Technique',
    label: 'Technique',
    color: 'var(--amber)',
    bg: 'rgba(255,174,0,.10)',
    desc: 'Matériel / équipement',
  },
  {
    key: 'Frais',
    label: 'Frais',
    color: 'var(--txt-2)',
    bg: 'var(--bg-elev)',
    desc: 'Frais divers',
  },
]

export const TYPES_OEUVRE = [
  { key: 'Fiction', label: 'Fiction' },
  { key: 'Flux', label: 'Flux / Plateau' },
  { key: 'Hors_fiction_flux', label: 'Documentaire / Autres' },
]

export const UNITES_MINIMAS = [
  { key: 'semaine_35h', label: 'Semaine 35h' },
  { key: 'semaine_39h', label: 'Semaine 39h' },
  { key: 'jour_7h', label: 'Jour 7h' },
  { key: 'jour_8h', label: 'Jour 8h' },
]

export default function AddLineModal({
  _catId,
  defaultRegime,
  prefilledPoste = null,
  prefilledIsSpec = false,
  prefilledProduit = null,
  onConfirm,
  onClose,
}) {
  const [step, setStep] = useState(
    prefilledPoste ? 'intermittent' : prefilledProduit ? 'other' : 'regime',
  )
  const [regime, setRegime] = useState(defaultRegime)
  // Intermittents
  const [typeOeuvre, setTypeOeuvre] = useState('Fiction')
  const [postes, setPostes] = useState([]) // liste depuis minimas_convention
  const [posteFilter, setPosteFilter] = useState('')
  const [selectedPoste, setSelectedPoste] = useState(prefilledPoste)
  const [isSpec, setIsSpec] = useState(prefilledIsSpec)
  const [unite, setUnite] = useState('jour_7h')
  const [montantBrut, setMontantBrut] = useState(null)
  const [loadingPostes, setLoadingPostes] = useState(false)
  // Ligne libre (autres régimes)
  const [produit, setProduit] = useState(prefilledProduit || '')
  const [description, setDescription] = useState('')
  const [qteSaisie, setQteSaisie] = useState(1)
  const [uniteSaisie, setUniteSaisie] = useState('J')
  const [tarifSaisie, setTarifSaisie] = useState(0)

  const isIntermittent = regime === 'Intermittent Technicien' || regime === 'Intermittent Artiste'

  // Charge les postes depuis Supabase quand type_oeuvre change (intermittents)
  useEffect(() => {
    if (!isIntermittent || step !== 'intermittent') return
    setLoadingPostes(true)
    // Ne réinitialise PAS le poste si pré-sélectionné depuis la barre de recherche inline
    if (!prefilledPoste) setSelectedPoste(null)
    setMontantBrut(null)
    supabase
      .from('minimas_convention')
      .select('poste, is_specialise')
      .eq('type_oeuvre', typeOeuvre)
      .eq('unite', 'jour_7h')
      .order('poste')
      .then(({ data }) => {
        // Dédoublonne les postes (garde spécialisé + non-spécialisé comme variantes)
        const unique = []
        const seen = new Set()
        for (const r of data || []) {
          const k = `${r.poste}__${r.is_specialise}`
          if (!seen.has(k)) {
            seen.add(k)
            unique.push(r)
          }
        }
        setPostes(unique)
        setLoadingPostes(false)
      })
  }, [typeOeuvre, step, isIntermittent]) // eslint-disable-line react-hooks/exhaustive-deps

  // Charge le montant brut quand poste + unité changent
  useEffect(() => {
    if (!selectedPoste || !isIntermittent) return
    supabase
      .from('minimas_convention')
      .select('montant_brut')
      .eq('type_oeuvre', typeOeuvre)
      .eq('poste', selectedPoste)
      .eq('is_specialise', isSpec)
      .eq('unite', unite)
      .single()
      .then(({ data }) => setMontantBrut(data ? Number(data.montant_brut) : null))
  }, [selectedPoste, isSpec, unite, typeOeuvre, isIntermittent])

  function handleRegimeSelect(r) {
    setRegime(r)
    if (r === 'Intermittent Technicien' || r === 'Intermittent Artiste') {
      setStep('intermittent')
    } else {
      setStep('other')
    }
  }

  function handleConfirmIntermittent() {
    if (!selectedPoste || !montantBrut) return
    // Unité → format court pour le champ unite de la ligne
    const uniteMap = { semaine_35h: 'S', semaine_39h: 'S', jour_7h: 'J', jour_8h: 'J' }
    onConfirm({
      produit: selectedPoste + (isSpec ? ' (spécialisé)' : ''),
      description: `${TYPES_OEUVRE.find((t) => t.key === typeOeuvre)?.label} — ${UNITES_MINIMAS.find((u) => u.key === unite)?.label}`,
      regime,
      quantite: 1,
      unite: uniteMap[unite] || 'J',
      tarif_ht: montantBrut,
      cout_ht: null,
    })
  }

  function handleConfirmOther() {
    if (!produit) return
    onConfirm({
      produit,
      description,
      regime,
      quantite: qteSaisie,
      unite: uniteSaisie,
      tarif_ht: tarifSaisie,
      cout_ht: null,
    })
  }

  const filteredPostes = postes.filter(
    (p) => !posteFilter || p.poste.toLowerCase().includes(posteFilter.toLowerCase()),
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: step === 'intermittent' ? 560 : 420,
          maxHeight: '85vh',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          boxShadow: '0 24px 80px rgba(0,0,0,.8)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
              Ajouter une ligne
            </h3>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {step === 'regime'
                ? 'Choisissez le régime de la prestation'
                : step === 'intermittent'
                  ? `${regime} — Grille conventionnelle CCPA`
                  : `${regime} — Saisie libre`}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ color: 'var(--txt-3)' }}
            className="hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {/* ── Étape 1 : Choix du régime ── */}
          {step === 'regime' && (
            <div className="grid grid-cols-2 gap-2">
              {REGIMES_LIST.map((r) => (
                <button
                  key={r.key}
                  onClick={() => handleRegimeSelect(r.key)}
                  className="text-left px-4 py-3 rounded-xl transition-all"
                  style={{
                    background: regime === r.key ? r.bg : 'var(--bg-elev)',
                    border: `1px solid ${regime === r.key ? r.color : 'var(--brd-sub)'}`,
                  }}
                >
                  <p className="text-xs font-bold" style={{ color: r.color }}>
                    {r.label}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                    {r.desc}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* ── Étape 2a : Intermittent — grille CCPA ── */}
          {step === 'intermittent' && (
            <div className="space-y-4">
              {/* Poste pré-sélectionné depuis la recherche */}
              {prefilledPoste && (
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{
                    background: 'rgba(156,95,253,.1)',
                    border: '1px solid rgba(156,95,253,.25)',
                  }}
                >
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: 'var(--purple)' }}
                  >
                    Poste
                  </span>
                  <span className="text-xs font-semibold flex-1" style={{ color: 'var(--txt)' }}>
                    {selectedPoste}
                  </span>
                  {isSpec && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}
                    >
                      spécialisé
                    </span>
                  )}
                </div>
              )}
              {/* Type d'œuvre */}
              <div>
                <label
                  className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Type d&apos;œuvre
                </label>
                <div className="flex gap-2">
                  {TYPES_OEUVRE.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTypeOeuvre(t.key)}
                      className="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background:
                          typeOeuvre === t.key ? 'rgba(156,95,253,.15)' : 'var(--bg-elev)',
                        border: `1px solid ${typeOeuvre === t.key ? 'rgba(156,95,253,.4)' : 'var(--brd-sub)'}`,
                        color: typeOeuvre === t.key ? 'var(--purple)' : 'var(--txt-2)',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recherche poste — masquée si poste pré-sélectionné depuis la recherche inline */}
              {!prefilledPoste && (
                <div>
                  <label
                    className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Poste ({filteredPostes.length})
                  </label>
                  <input
                    className="input w-full text-xs mb-2"
                    placeholder="Rechercher un poste…"
                    value={posteFilter}
                    onChange={(e) => setPosteFilter(e.target.value)}
                    autoFocus
                  />
                  <div
                    className="overflow-y-auto rounded-xl"
                    style={{ maxHeight: 220, border: '1px solid var(--brd-sub)' }}
                  >
                    {loadingPostes ? (
                      <div className="p-4 text-center text-xs" style={{ color: 'var(--txt-3)' }}>
                        Chargement…
                      </div>
                    ) : filteredPostes.length === 0 ? (
                      <div className="p-4 text-center text-xs" style={{ color: 'var(--txt-3)' }}>
                        Aucun résultat
                      </div>
                    ) : (
                      filteredPostes.map((p, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSelectedPoste(p.poste)
                            setIsSpec(p.is_specialise)
                          }}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
                          style={{
                            background:
                              selectedPoste === p.poste && isSpec === p.is_specialise
                                ? 'rgba(156,95,253,.1)'
                                : 'transparent',
                            borderBottom:
                              i < filteredPostes.length - 1 ? '1px solid var(--brd-sub)' : 'none',
                            color:
                              selectedPoste === p.poste && isSpec === p.is_specialise
                                ? 'var(--purple)'
                                : 'var(--txt)',
                          }}
                        >
                          <span className="text-xs flex-1">{p.poste}</span>
                          {p.is_specialise && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}
                            >
                              spécialisé
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Unité + montant */}
              {selectedPoste && (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label
                      className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      Unité
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {UNITES_MINIMAS.map((u) => (
                        <button
                          key={u.key}
                          onClick={() => setUnite(u.key)}
                          className="py-1.5 px-2 rounded-lg text-xs font-medium transition-all"
                          style={{
                            background: unite === u.key ? 'rgba(156,95,253,.15)' : 'var(--bg-elev)',
                            border: `1px solid ${unite === u.key ? 'rgba(156,95,253,.4)' : 'var(--brd-sub)'}`,
                            color: unite === u.key ? 'var(--purple)' : 'var(--txt-3)',
                          }}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {montantBrut != null && (
                    <div className="text-right shrink-0">
                      <p className="text-[11px] mb-0.5" style={{ color: 'var(--txt-3)' }}>
                        Minima brut
                      </p>
                      <p className="text-xl font-bold" style={{ color: 'var(--purple)' }}>
                        {montantBrut.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        €
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                        tarif pré-rempli
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Étape 2b : Autres régimes — saisie libre ── */}
          {step === 'other' && (
            <div className="space-y-3">
              <div>
                <label
                  className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Poste / Intitulé *
                </label>
                <input
                  className="input w-full text-sm"
                  placeholder="Ex : Location caméra, Transport…"
                  value={produit}
                  onChange={(e) => setProduit(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label
                  className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Description
                </label>
                <input
                  className="input w-full text-sm"
                  placeholder="Optionnel…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label
                    className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Quantité
                  </label>
                  <input
                    type="number"
                    className="input w-full text-right"
                    min={0}
                    step={0.5}
                    value={qteSaisie}
                    onChange={(e) => setQteSaisie(parseFloat(e.target.value) || 1)}
                  />
                </div>
                <div className="w-24">
                  <label
                    className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Unité
                  </label>
                  <select
                    className="input w-full text-sm"
                    value={uniteSaisie}
                    onChange={(e) => setUniteSaisie(e.target.value)}
                  >
                    {UNITES.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label
                    className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Tarif HT
                  </label>
                  <input
                    type="number"
                    className="input w-full text-right"
                    min={0}
                    step={1}
                    value={tarifSaisie}
                    onChange={(e) => setTarifSaisie(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer — boutons */}
        {step !== 'regime' && (
          <div
            className="flex items-center justify-between px-5 py-3.5"
            style={{ borderTop: '1px solid var(--brd-sub)' }}
          >
            <button
              onClick={() => setStep('regime')}
              className="btn-ghost btn-sm text-xs"
              style={{ color: 'var(--txt-3)' }}
            >
              ← Changer de régime
            </button>
            <button
              onClick={step === 'intermittent' ? handleConfirmIntermittent : handleConfirmOther}
              disabled={step === 'intermittent' ? !selectedPoste || !montantBrut : !produit}
              className="btn-primary btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter la ligne
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

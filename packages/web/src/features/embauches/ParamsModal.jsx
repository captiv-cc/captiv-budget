// ════════════════════════════════════════════════════════════════════════════
// ParamsModal — règles de majoration, une convention à la fois
// ════════════════════════════════════════════════════════════════════════════
//
// Dimanche, férié, nuit, seuil d'heures supplémentaires et plage de nuit ne
// sont pas les mêmes d'une convention à l'autre : chaque convention a sa
// ligne. Tant qu'elle n'est pas enregistrée, le calcul tourne sur les valeurs
// par défaut (celles de la production audiovisuelle) et la modale le dit.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { AlertTriangle, Loader2, Save, X } from 'lucide-react'
import { notify } from '../../lib/notify'
import { CONVENTIONS, DEFAULT_PARAMS } from '../../lib/embauches'
import { saveParams } from '../../lib/embauchesData'

const inputStyle = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

function Champ({ label, aide, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium mb-1" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
      {children}
      {aide && (
        <span className="block text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
          {aide}
        </span>
      )}
    </label>
  )
}

function Pourcent({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="1"
        min="0"
        value={Math.round((Number(value) || 0) * 100)}
        onChange={(e) => onChange((Number(e.target.value) || 0) / 100)}
        className="w-24 px-2.5 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums"
        style={inputStyle}
      />
      <span className="text-sm" style={{ color: 'var(--txt-3)' }}>
        %
      </span>
    </div>
  )
}

export default function ParamsModal({ orgId, parConvention, onClose, onSaved }) {
  const [convention, setConvention] = useState(CONVENTIONS[0].key)
  const [brouillons, setBrouillons] = useState(() => {
    const out = {}
    for (const c of CONVENTIONS) {
      out[c.key] = { ...DEFAULT_PARAMS, ...(parConvention?.[c.key] || {}) }
    }
    return out
  })
  const [saving, setSaving] = useState(false)

  const form = brouillons[convention]
  const jamaisEnregistre = parConvention?.[convention]?._defaut !== false
  const set = (k, v) =>
    setBrouillons((b) => ({ ...b, [convention]: { ...b[convention], [k]: v } }))

  async function enregistrer() {
    setSaving(true)
    try {
      const ligne = await saveParams(orgId, convention, {
        seuil_hs_hebdo: Number(form.seuil_hs_hebdo) || 0,
        maj_hs: Number(form.maj_hs) || 0,
        maj_dimanche: Number(form.maj_dimanche) || 0,
        maj_ferie: Number(form.maj_ferie) || 0,
        maj_nuit: Number(form.maj_nuit) || 0,
        nuit_debut: form.nuit_debut,
        nuit_fin: form.nuit_fin,
        taux_charges_estime: Number(form.taux_charges_estime) || 0,
        coef_vente_defaut: Number(form.coef_vente_defaut) || 0,
        frais_dossier_facture_defaut: Number(form.frais_dossier_facture_defaut) || 0,
        frais_dossier_cout_defaut: Number(form.frais_dossier_cout_defaut) || 0,
      })
      notify.success('Réglages enregistrés.')
      onSaved?.(convention, ligne)
    } catch (err) {
      console.error('[embauches] saveParams:', err)
      notify.error('Enregistrement : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,.5)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className="w-full max-w-2xl rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--brd)',
          maxHeight: 'calc(100vh - 2rem)',
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd)' }}
        >
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Règles de calcul
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 [&>*]:shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {CONVENTIONS.map((c) => {
              const actif = c.key === convention
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setConvention(c.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-left"
                  style={{
                    background: actif ? 'var(--blue-bg)' : 'var(--bg-elev)',
                    border: `1px solid ${actif ? 'var(--blue)' : 'var(--brd)'}`,
                    color: actif ? 'var(--blue)' : 'var(--txt-2)',
                  }}
                >
                  {c.label}
                </button>
              )
            })}
          </div>

          {jamaisEnregistre && (
            <p
              className="flex items-start gap-2 text-[11px] px-3 py-2 rounded-lg"
              style={{ background: 'rgba(255,159,10,.10)', color: 'var(--amber)' }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              Rien n’a encore été enregistré pour cette convention. Les valeurs
              affichées sont celles de la production audiovisuelle : à vérifier avant
              de s’y fier.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Champ label="Majoration du dimanche">
              <Pourcent value={form.maj_dimanche} onChange={(v) => set('maj_dimanche', v)} />
            </Champ>
            <Champ label="Majoration d’un jour férié">
              <Pourcent value={form.maj_ferie} onChange={(v) => set('maj_ferie', v)} />
            </Champ>
            <Champ label="Majoration de nuit">
              <Pourcent value={form.maj_nuit} onChange={(v) => set('maj_nuit', v)} />
            </Champ>
            <Champ
              label="Majoration des heures supplémentaires"
              aide="Appliquée au-delà du seuil hebdomadaire."
            >
              <Pourcent value={form.maj_hs} onChange={(v) => set('maj_hs', v)} />
            </Champ>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Champ label="Seuil hebdomadaire" aide="Heures par semaine.">
              <input
                type="number"
                step="1"
                min="0"
                value={form.seuil_hs_hebdo ?? ''}
                onChange={(e) => set('seuil_hs_hebdo', Number(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums"
                style={inputStyle}
              />
            </Champ>
            <Champ label="Nuit, début">
              <input
                type="time"
                value={String(form.nuit_debut || '').slice(0, 5)}
                onChange={(e) => set('nuit_debut', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
                style={inputStyle}
              />
            </Champ>
            <Champ label="Nuit, fin">
              <input
                type="time"
                value={String(form.nuit_fin || '').slice(0, 5)}
                onChange={(e) => set('nuit_fin', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
                style={inputStyle}
              />
            </Champ>
          </div>

          <div className="pt-3" style={{ borderTop: '1px solid var(--brd-sub)' }}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--txt-3)' }}>
              Valeurs par défaut des dossiers
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Champ label="Coefficient de vente">
                <Pourcent
                  value={form.coef_vente_defaut}
                  onChange={(v) => set('coef_vente_defaut', v)}
                />
              </Champ>
              <Champ
                label="Charges estimées"
                aide="Sert d’estimation tant que Movinmotion n’a pas rendu son chiffre."
              >
                <Pourcent
                  value={form.taux_charges_estime}
                  onChange={(v) => set('taux_charges_estime', v)}
                />
              </Champ>
              <Champ label="Frais de dossier facturés">
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.frais_dossier_facture_defaut ?? ''}
                  onChange={(e) =>
                    set('frais_dossier_facture_defaut', Number(e.target.value) || 0)
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums"
                  style={inputStyle}
                />
              </Champ>
              <Champ label="Frais de dossier dus">
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.frais_dossier_cout_defaut ?? ''}
                  onChange={(e) => set('frais_dossier_cout_defaut', Number(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums"
                  style={inputStyle}
                />
              </Champ>
            </div>
          </div>
        </div>

        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={enregistrer}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ background: 'var(--blue)', color: '#fff', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Enregistrer
          </button>
        </footer>
      </div>
    </div>
  )
}

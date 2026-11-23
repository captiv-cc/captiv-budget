// ════════════════════════════════════════════════════════════════════════════
// DossierModal — création et réglages d'un dossier d'embauches
// ════════════════════════════════════════════════════════════════════════════
//
// Le mode de facturation est demandé À LA CRÉATION, sans valeur par défaut :
// appliquer 80 % à un projet interne gonflerait un coût qu'on veut au réel.
// Une fois posé il reste modifiable, mais jamais deviné.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { X, Loader2, Save, Link2 } from 'lucide-react'
import CustomSelect from '../../components/CustomSelect'
import DayPicker from '../../components/DayPicker'
import { supabase } from '../../lib/supabase'
import { notify } from '../../lib/notify'
import { MODES, STATUTS_DOSSIER } from '../../lib/embauches'
import { createDossier, updateDossier } from '../../lib/embauchesData'

const inputStyle = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

function Champ({ label, aide, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
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

function Txt({ value, onChange, ...rest }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
      style={inputStyle}
      {...rest}
    />
  )
}

export default function DossierModal({ dossier = null, orgId, projectId = null, onClose, onSaved }) {
  const creation = !dossier?.id

  const [form, setForm] = useState(() => ({
    nom: dossier?.nom || '',
    mode: dossier?.mode || null, // pas de défaut : choix explicite
    coef_vente: dossier?.coef_vente ?? 0.8,
    client_id: dossier?.client_id || null,
    project_id: dossier?.project_id || projectId || null,
    convention: dossier?.convention || 'CCN de la production audiovisuelle (2642)',
    type_projet: dossier?.type_projet || '',
    numero_objet: dossier?.numero_objet || '',
    lieu: dossier?.lieu || '',
    resume: dossier?.resume || '',
    bon_commande: dossier?.bon_commande || '',
    statut: dossier?.statut || 'en_cours',
    date_debut: dossier?.date_debut || null,
    date_fin: dossier?.date_fin || null,
    notes: dossier?.notes || '',
  }))
  const [clients, setClients] = useState([])
  const [projets, setProjets] = useState([])
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('clients')
      .select('id, nom')
      .eq('org_id', orgId)
      .order('nom')
      .then(({ data }) => setClients(data || []))
    supabase
      .from('projects')
      .select('id, nom')
      .eq('org_id', orgId)
      .neq('status', 'archive')
      .order('nom')
      .then(({ data }) => setProjets(data || []))
  }, [orgId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function enregistrer() {
    if (!form.nom.trim()) {
      notify.error('Il faut un nom de dossier.')
      return
    }
    if (!form.mode) {
      notify.error('Choisissez un mode de facturation.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        org_id: orgId,
        coef_vente: form.mode === 'frais_reels' ? 0 : Number(form.coef_vente) || 0,
      }
      const row = creation ? await createDossier(payload) : await updateDossier(dossier.id, payload)
      notify.success(creation ? 'Dossier créé.' : 'Dossier enregistré.')
      onSaved?.(row)
      onClose?.()
    } catch (err) {
      console.error('[embauches] dossier:', err)
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
            {creation ? 'Nouveau dossier' : 'Réglages du dossier'}
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
          <Champ label="Nom du dossier">
            <Txt value={form.nom} onChange={(v) => set('nom', v)} placeholder="Leroy Merlin" />
          </Champ>

          {/* Mode de facturation */}
          <div>
            <span className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--txt-3)' }}>
              Mode de facturation
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MODES.map((m) => {
                const actif = form.mode === m.key
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => set('mode', m.key)}
                    className="text-left px-3 py-2.5 rounded-xl"
                    style={{
                      background: actif ? 'var(--blue-bg)' : 'var(--bg-surf)',
                      border: `1px solid ${actif ? 'var(--blue)' : 'var(--brd)'}`,
                    }}
                  >
                    <span
                      className="block text-sm font-semibold"
                      style={{ color: actif ? 'var(--blue)' : 'var(--txt)' }}
                    >
                      {m.label}
                    </span>
                    <span className="block text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                      {m.aide}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {form.mode === 'portage' && (
            <Champ
              label="Coefficient de vente"
              aide="Appliqué au brut et aux majorations. Les défraiements n'en portent jamais."
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={Math.round((Number(form.coef_vente) || 0) * 100)}
                  onChange={(e) => set('coef_vente', (Number(e.target.value) || 0) / 100)}
                  className="w-28 px-2.5 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums"
                  style={inputStyle}
                />
                <span className="text-sm" style={{ color: 'var(--txt-3)' }}>
                  %
                </span>
              </div>
            </Champ>
          )}

          {form.mode === 'frais_reels' && (
            <p
              className="text-[11px] px-3 py-2 rounded-lg"
              style={{ background: 'rgba(255,159,10,.10)', color: 'var(--amber)' }}
            >
              Le montant facturé suivra le coût réel. Tant que Movinmotion n’a pas rendu son
              chiffre, ce montant reste une estimation.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Champ label="Client">
              <CustomSelect
                value={form.client_id || ''}
                options={[
                  { value: '', label: 'Aucun (suivi interne)' },
                  ...clients.map((c) => ({ value: c.id, label: c.nom })),
                ]}
                onChange={(v) => set('client_id', v || null)}
                triggerClassName="w-full px-2.5 py-1.5 rounded-lg text-sm text-left"
                triggerStyle={inputStyle}
              />
            </Champ>
            <Champ label="Projet du Desk" aide="Optionnel : le dossier peut vivre seul.">
              <CustomSelect
                value={form.project_id || ''}
                options={[
                  { value: '', label: 'Aucun' },
                  ...projets.map((p) => ({ value: p.id, label: p.nom })),
                ]}
                onChange={(v) => set('project_id', v || null)}
                triggerClassName="w-full px-2.5 py-1.5 rounded-lg text-sm text-left"
                triggerStyle={inputStyle}
              />
            </Champ>
          </div>

          <div
            className="pt-3"
            style={{ borderTop: '1px solid var(--brd-sub)' }}
          >
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--txt-3)' }}>
              Informations Movinmotion
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Champ label="Convention collective">
                <Txt value={form.convention} onChange={(v) => set('convention', v)} />
              </Champ>
              <Champ label="Type de projet">
                <Txt
                  value={form.type_projet}
                  onChange={(v) => set('type_projet', v)}
                  placeholder="Captation"
                />
              </Champ>
              <Champ label="Numéro d'objet">
                <Txt value={form.numero_objet} onChange={(v) => set('numero_objet', v)} />
              </Champ>
              <Champ label="Lieu de la prestation">
                <Txt value={form.lieu} onChange={(v) => set('lieu', v)} />
              </Champ>
            </div>
            <Champ label="Résumé" className="mt-3">
              <Txt value={form.resume} onChange={(v) => set('resume', v)} />
            </Champ>
          </div>

          <div className="pt-3" style={{ borderTop: '1px solid var(--brd-sub)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Champ label="Bon de commande">
                <Txt value={form.bon_commande} onChange={(v) => set('bon_commande', v)} />
              </Champ>
              <Champ label="Statut">
                <CustomSelect
                  value={form.statut}
                  options={STATUTS_DOSSIER.map((s) => ({ value: s.key, label: s.label }))}
                  onChange={(v) => set('statut', v)}
                  triggerClassName="w-full px-2.5 py-1.5 rounded-lg text-sm text-left"
                  triggerStyle={inputStyle}
                />
              </Champ>
              <Champ label="Début">
                <DayPicker value={form.date_debut} onChange={(v) => set('date_debut', v)} />
              </Champ>
              <Champ label="Fin">
                <DayPicker value={form.date_fin} onChange={(v) => set('date_fin', v)} />
              </Champ>
            </div>
          </div>

          {form.project_id && (
            <p
              className="flex items-center gap-1.5 text-[11px]"
              style={{ color: 'var(--txt-3)' }}
            >
              <Link2 className="w-3.5 h-3.5" />
              Ce dossier apparaîtra dans l’onglet Embauches du projet.
            </p>
          )}
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
            Annuler
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

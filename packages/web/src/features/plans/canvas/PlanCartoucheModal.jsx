// ════════════════════════════════════════════════════════════════════════════
// PlanCartoucheModal — mise en page du PDF : cartouche pro (axe #9)
// ════════════════════════════════════════════════════════════════════════════
//
// Configure la bande de cartouche du PDF exporté : logos (1-3, logo org par
// défaut), projet / réf / client / lieu / dates, personnes (rôle + nom,
// presets + libre), contact, mention de pied, format A3/A4. Persisté par plan
// dans plans_canvas.cartouche (jsonb) — pré-rempli depuis le projet à la
// première ouverture.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { notify } from '../../../lib/notify'
import { updateCanvas } from '../../../lib/plansCanvas'
import {
  CARTOUCHE_ROLES,
  MAX_LOGOS,
  emptyCartouche,
  fetchCartoucheDefaults,
  uploadCartoucheLogo,
  logoToDataUrl,
} from '../../../lib/plansCanvasCartouche'

const inputStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function TextInput({ value, onChange, placeholder = '' }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
      style={inputStyle}
    />
  )
}

export default function PlanCartoucheModal({ canvas, org, onClose, onSaved }) {
  const [form, setForm] = useState(null) // null = chargement des défauts
  const [saving, setSaving] = useState(false)
  const [logoPreviews, setLogoPreviews] = useState({}) // ref → dataURL
  const fileRef = useRef(null)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  // Init : cartouche sauvé, sinon défauts projet + logo org.
  useEffect(() => {
    let alive = true
    async function init() {
      if (canvas.cartouche) {
        if (alive) setForm({ ...emptyCartouche(), ...canvas.cartouche })
        return
      }
      const defaults = await fetchCartoucheDefaults(canvas.project_id)
      // Papier blanc → variante « claire » d'abord (même ordre que les autres
      // PDF : matériel, livrables, techlist).
      const orgLogo = org?.logo_banner_url || org?.logo_url_clair || org?.logo_url_sombre
      if (alive) {
        setForm({
          ...emptyCartouche(),
          ...defaults,
          logos: orgLogo ? [{ kind: 'url', ref: orgLogo }] : [],
        })
      }
    }
    init()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.id])

  // Aperçus des logos (dataURL, résolus par kind).
  useEffect(() => {
    if (!form) return
    form.logos.forEach((logo) => {
      if (logoPreviews[logo.ref]) return
      logoToDataUrl(logo)
        .then((url) => setLogoPreviews((p) => ({ ...p, [logo.ref]: url })))
        .catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.logos])

  async function addLogoFile(file) {
    if (!file || form.logos.length >= MAX_LOGOS) return
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      notify.error('Logo : PNG ou JPEG uniquement (pas de WebP dans le PDF)')
      return
    }
    try {
      const path = await uploadCartoucheLogo({
        projectId: canvas.project_id,
        canvasId: canvas.id,
        file,
      })
      set({ logos: [...form.logos, { kind: 'storage', ref: path }] })
    } catch (err) {
      notify.error('Upload du logo échoué : ' + (err?.message || err))
    }
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const cartouche = {
        ...form,
        personnes: form.personnes.filter((p) => p.role.trim() || p.nom.trim()),
        infos: (form.infos || []).filter((i) => i.label.trim() || i.valeur.trim()),
      }
      const row = await updateCanvas(canvas.id, { cartouche })
      onSaved?.(row.cartouche)
      onClose()
    } catch (err) {
      notify.error('Enregistrement impossible : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 900 }}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />
      <div
        className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl overflow-hidden"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--brd)' }}>
          <div className="flex-1">
            <div className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
              Mise en page du PDF
            </div>
            <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              Cartouche en bas de page — mémorisé pour ce plan. Version et date
              d’édition sont ajoutées automatiquement.
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {!form ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--txt-3)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Pré-remplissage depuis le projet…
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Projet */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nom du projet">
                <TextInput value={form.projet} onChange={(projet) => set({ projet })} />
              </Field>
              <Field label="Référence">
                <TextInput value={form.ref} onChange={(ref) => set({ ref })} placeholder="CAP-2026-042" />
              </Field>
              <Field label="Client / organisateur">
                <TextInput value={form.client} onChange={(client) => set({ client })} />
              </Field>
              <Field label="Lieu">
                <TextInput value={form.lieu} onChange={(lieu) => set({ lieu })} placeholder="Zénith de Nantes" />
              </Field>
              <Field label="Date(s) de l'événement">
                <TextInput
                  value={form.dateEvenement}
                  onChange={(dateEvenement) => set({ dateEvenement })}
                  placeholder="14-15 mars 2026"
                />
              </Field>
              <Field label="Contact (DT / prod)">
                <TextInput
                  value={form.contact}
                  onChange={(contact) => set({ contact })}
                  placeholder="H. Martin · 06… · dt@captiv.cc"
                />
              </Field>
            </div>

            {/* Infos libres du bloc projet */}
            <div>
              <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
                Infos (bloc projet, sous la version)
              </div>
              {(form.infos || []).map((info, i) => (
                <div key={i} className="flex items-center gap-1.5 mb-1.5">
                  <input
                    type="text"
                    value={info.label}
                    placeholder="Production"
                    onChange={(e) => {
                      const infos = [...form.infos]
                      infos[i] = { ...info, label: e.target.value }
                      set({ infos })
                    }}
                    className="w-44 text-xs px-2 py-1.5 rounded-md outline-none"
                    style={inputStyle}
                  />
                  <input
                    type="text"
                    value={info.valeur}
                    placeholder="ZQSD"
                    onChange={(e) => {
                      const infos = [...form.infos]
                      infos[i] = { ...info, valeur: e.target.value }
                      set({ infos })
                    }}
                    className="flex-1 text-xs px-2 py-1.5 rounded-md outline-none"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => set({ infos: form.infos.filter((_, j) => j !== i) })}
                    className="p-1.5"
                    style={{ color: 'var(--txt-3)' }}
                    title="Retirer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => set({ infos: [...(form.infos || []), { label: '', valeur: '' }] })}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md"
                style={{ color: 'var(--blue)' }}
              >
                <Plus className="w-3 h-3" />
                Ajouter une info
              </button>
            </div>

            {/* Personnes */}
            <div>
              <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
                Personnes (rôle + nom)
              </div>
              {form.personnes.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5 mb-1.5">
                  <input
                    type="text"
                    value={p.role}
                    list="cartouche-roles"
                    placeholder="Rôle"
                    onChange={(e) => {
                      const personnes = [...form.personnes]
                      personnes[i] = { ...p, role: e.target.value }
                      set({ personnes })
                    }}
                    className="w-44 text-xs px-2 py-1.5 rounded-md outline-none"
                    style={inputStyle}
                  />
                  <input
                    type="text"
                    value={p.nom}
                    placeholder="Nom"
                    onChange={(e) => {
                      const personnes = [...form.personnes]
                      personnes[i] = { ...p, nom: e.target.value }
                      set({ personnes })
                    }}
                    className="flex-1 text-xs px-2 py-1.5 rounded-md outline-none"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => set({ personnes: form.personnes.filter((_, j) => j !== i) })}
                    className="p-1.5"
                    style={{ color: 'var(--txt-3)' }}
                    title="Retirer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <datalist id="cartouche-roles">
                {CARTOUCHE_ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => set({ personnes: [...form.personnes, { role: '', nom: '' }] })}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md"
                style={{ color: 'var(--blue)' }}
              >
                <Plus className="w-3 h-3" />
                Ajouter une personne
              </button>
            </div>

            {/* Logos */}
            <div>
              <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
                Logos ({form.logos.length}/{MAX_LOGOS})
              </div>
              <div className="flex items-center gap-2">
                {form.logos.map((logo, i) => (
                  <div
                    key={logo.ref}
                    className="relative w-24 h-14 rounded-md flex items-center justify-center overflow-hidden group"
                    style={{ background: '#ffffff', border: '1px solid var(--brd)' }}
                    title={logo.kind === 'url' ? 'Logo de l’organisation' : 'Logo importé'}
                  >
                    {logoPreviews[logo.ref] ? (
                      <img src={logoPreviews[logo.ref]} alt={`Logo ${i + 1}`} className="max-w-full max-h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-4 h-4" style={{ color: '#999' }} />
                    )}
                    <button
                      type="button"
                      onClick={() => set({ logos: form.logos.filter((_, j) => j !== i) })}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100"
                      style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                      title="Retirer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {form.logos.length < MAX_LOGOS && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-24 h-14 rounded-md flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold"
                    style={{ border: '1px dashed var(--brd)', color: 'var(--txt-3)' }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Importer
                  </button>
                )}
                {(() => {
                  const orgLogo =
                    org?.logo_banner_url || org?.logo_url_clair || org?.logo_url_sombre
                  const present = form.logos.some((l) => l.ref === orgLogo)
                  if (!orgLogo || present || form.logos.length >= MAX_LOGOS) return null
                  return (
                    <button
                      type="button"
                      onClick={() => set({ logos: [{ kind: 'url', ref: orgLogo }, ...form.logos] })}
                      className="text-[10px] font-semibold px-2 py-1.5 rounded-md"
                      style={{ border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
                      title="Ajoute le logo de l’organisation (variante pour fond clair)"
                    >
                      + Logo de l’org
                    </button>
                  )
                })()}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    addLogoFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>
            </div>

            {/* Mention + format */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <Field label="Mention de pied (optionnel)">
                <TextInput
                  value={form.mention}
                  onChange={(mention) => set({ mention })}
                  placeholder="Côtes à vérifier sur site · diffusion restreinte"
                />
              </Field>
              <Field label="Format">
                <div className="flex items-center gap-1">
                  {['a3', 'a4'].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => set({ format: f })}
                      className="text-[11px] font-bold px-2.5 py-1.5 rounded-md uppercase"
                      style={{
                        background: form.format === f ? 'var(--blue)' : 'var(--bg)',
                        color: form.format === f ? '#fff' : 'var(--txt-2)',
                        border: '1px solid var(--brd)',
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--brd)' }}>
          <button type="button" onClick={onClose} className="text-xs font-semibold px-3 py-1.5 rounded-md" style={{ color: 'var(--txt-3)' }}>
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!form || saving}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-md"
            style={{ background: 'var(--blue)', color: '#fff', opacity: !form || saving ? 0.6 : 1 }}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

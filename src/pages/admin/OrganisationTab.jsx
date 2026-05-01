/**
 * Onglet Paramètres > Organisation — MT-PRE-1.A Étape B
 *
 * Édition de l'identité visuelle et légale de l'organisation. Ces
 * informations alimentent les PDFs (devis, livrables, bilans matériel),
 * la page de partage client, et l'UI app (sidebar, login, etc.).
 *
 * Sections (toutes repliables, ouvertes par défaut) :
 *   1. Identité commerciale (display_name, tagline, website_url)
 *   2. Identité légale (legal_name, forme, capital, siret, ape, tva,
 *      ville_rcs, siren calculé) avec toggles de visibilité PDF
 *   3. Coordonnées (address, email, phone)
 *   4. Branding visuel (logos clair/sombre, signature, couleur de marque)
 *   5. Page de partage client (share_intro_text)
 *
 * Visible aux admins uniquement (gardé au niveau route).
 */

import { useEffect, useRef, useState } from 'react'
import {
  Briefcase,
  FileText,
  MapPin,
  Image as ImageIcon,
  Share2,
  Save,
  RefreshCw,
  Upload,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Receipt,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'

// ─── Palette de couleurs prédéfinies (recopiée du pattern Templates) ────────
const BRAND_COLORS = [
  '#3B82F6', // bleu
  '#8B5CF6', // violet
  '#EC4899', // rose
  '#EF4444', // rouge
  '#F97316', // orange
  '#F5A623', // ambre
  '#10B981', // vert
  '#14B8A6', // teal
  '#0EA5E9', // sky
  '#6366F1', // indigo
]

// ─── Champs légaux et leurs clés JSON pour la visibilité PDF ────────────────
// Placeholders volontairement génériques pour rester pertinents quelle que
// soit la société qui s'inscrit (pas d'exemples spécifiques à Captiv).
const LEGAL_FIELDS = [
  { key: 'legal_name',      label: 'Raison sociale',            placeholder: 'Ex : Société XYZ', required: true },
  { key: 'forme_juridique', label: 'Forme juridique',           placeholder: 'SARL, SAS, SA…' },
  { key: 'capital_social',  label: 'Capital social',            placeholder: 'Ex : 10 000 €' },
  { key: 'siret',           label: 'SIRET',                     placeholder: '14 chiffres' },
  { key: 'code_ape',        label: 'Code APE',                  placeholder: 'Ex : 5911A' },
  { key: 'tva_number',      label: 'N° TVA intracommunautaire', placeholder: 'FR + 11 chiffres' },
  { key: 'ville_rcs',       label: 'Ville RCS',                 placeholder: 'Ex : Paris' },
]

// ─── Helper : calcul du SIREN depuis SIRET (9 premiers chiffres) ────────────
function computeSiren(siret) {
  if (!siret) return ''
  const digits = String(siret).replace(/\D/g, '').slice(0, 9)
  if (digits.length < 9) return ''
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`
}

// ─── Composant principal ────────────────────────────────────────────────────
export default function OrganisationTab() {
  const { org, setOrg } = useAuth()
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [openSections, setOpenSections] = useState({
    commercial: true, legal: true, contact: true, branding: true, share: true, devis: true,
  })

  // Hydrate le draft depuis l'org au premier render et à chaque changement d'org
  useEffect(() => {
    if (!org) return
    setDraft({
      display_name: org.display_name || '',
      tagline: org.tagline || '',
      website_url: org.website_url || '',
      legal_name: org.legal_name || '',
      forme_juridique: org.forme_juridique || '',
      capital_social: org.capital_social || '',
      siret: org.siret || '',
      code_ape: org.code_ape || '',
      tva_number: org.tva_number || '',
      ville_rcs: org.ville_rcs || '',
      address: org.address || '',
      email: org.email || '',
      phone: org.phone || '',
      logo_url_clair: org.logo_url_clair || '',
      logo_url_sombre: org.logo_url_sombre || '',
      logo_banner_url: org.logo_banner_url || '',
      signature_url: org.signature_url || '',
      brand_color: org.brand_color || '#3B82F6',
      pdf_field_visibility: org.pdf_field_visibility || {
        legal_name: true, forme_juridique: true, capital_social: true,
        siret: true, code_ape: true, tva_number: true, ville_rcs: true, siren: true,
      },
      share_intro_text: org.share_intro_text || '',
      pdf_devis_annulation_text: org.pdf_devis_annulation_text || '',
      pdf_devis_reglement_text: org.pdf_devis_reglement_text || '',
      pdf_devis_cgv_text: org.pdf_devis_cgv_text || '',
    })
  }, [org])

  if (!org || !draft) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--txt-3)' }} />
      </div>
    )
  }

  const dirty = (() => {
    if (!org) return false
    const keys = Object.keys(draft).filter((k) => k !== 'pdf_field_visibility')
    if (keys.some((k) => (draft[k] || '') !== (org[k] || ''))) return true
    const dv = draft.pdf_field_visibility || {}
    const ov = org.pdf_field_visibility || {}
    return Object.keys({ ...dv, ...ov }).some((k) => Boolean(dv[k]) !== Boolean(ov[k]))
  })()

  const set = (k, v) => setDraft((p) => ({ ...p, [k]: v }))
  const setVis = (k, v) =>
    setDraft((p) => ({ ...p, pdf_field_visibility: { ...p.pdf_field_visibility, [k]: v } }))
  const toggle = (sec) => setOpenSections((s) => ({ ...s, [sec]: !s[sec] }))

  async function handleSave() {
    if (saving) return
    // Validation client : champs requis (cohérent avec contrainte NOT NULL en BDD)
    const dn = (draft.display_name || '').trim()
    const ln = (draft.legal_name || '').trim()
    if (!dn) {
      notify.error('Le nom commercial est obligatoire.')
      return
    }
    if (!ln) {
      notify.error('La raison sociale est obligatoire.')
      return
    }
    setSaving(true)
    const payload = {
      display_name: dn,
      tagline: draft.tagline || null,
      website_url: draft.website_url || null,
      legal_name: ln,
      forme_juridique: draft.forme_juridique || null,
      capital_social: draft.capital_social || null,
      siret: draft.siret || null,
      code_ape: draft.code_ape || null,
      tva_number: draft.tva_number || null,
      ville_rcs: draft.ville_rcs || null,
      address: draft.address || null,
      email: draft.email || null,
      phone: draft.phone || null,
      logo_url_clair: draft.logo_url_clair || null,
      logo_url_sombre: draft.logo_url_sombre || null,
      logo_banner_url: draft.logo_banner_url || null,
      signature_url: draft.signature_url || null,
      brand_color: draft.brand_color || '#3B82F6',
      pdf_field_visibility: draft.pdf_field_visibility || {},
      share_intro_text: draft.share_intro_text || null,
      pdf_devis_annulation_text: draft.pdf_devis_annulation_text || null,
      pdf_devis_reglement_text: draft.pdf_devis_reglement_text || null,
      pdf_devis_cgv_text: draft.pdf_devis_cgv_text || null,
    }
    const { data, error } = await supabase
      .from('organisations')
      .update(payload)
      .eq('id', org.id)
      .select('*')
      .maybeSingle()
    setSaving(false)
    if (error) {
      notify.error('Erreur sauvegarde : ' + error.message)
      return
    }
    // Succès : on notifie systématiquement.
    // Si la RLS post-update n'a pas renvoyé la row, on rafraîchit
    // par un SELECT séparé pour garantir la mise à jour du state.
    if (data) {
      setOrg(data)
    } else {
      const { data: refreshed } = await supabase
        .from('organisations')
        .select('*')
        .eq('id', org.id)
        .maybeSingle()
      if (refreshed) setOrg(refreshed)
    }
    notify.success('Identité de la société enregistrée.')
  }

  function handleReset() {
    setDraft({
      display_name: org.display_name || '',
      tagline: org.tagline || '',
      website_url: org.website_url || '',
      legal_name: org.legal_name || '',
      forme_juridique: org.forme_juridique || '',
      capital_social: org.capital_social || '',
      siret: org.siret || '',
      code_ape: org.code_ape || '',
      tva_number: org.tva_number || '',
      ville_rcs: org.ville_rcs || '',
      address: org.address || '',
      email: org.email || '',
      phone: org.phone || '',
      logo_url_clair: org.logo_url_clair || '',
      logo_url_sombre: org.logo_url_sombre || '',
      logo_banner_url: org.logo_banner_url || '',
      signature_url: org.signature_url || '',
      brand_color: org.brand_color || '#3B82F6',
      pdf_field_visibility: org.pdf_field_visibility || {
        legal_name: true, forme_juridique: true, capital_social: true,
        siret: true, code_ape: true, tva_number: true, ville_rcs: true, siren: true,
      },
      share_intro_text: org.share_intro_text || '',
      pdf_devis_annulation_text: org.pdf_devis_annulation_text || '',
      pdf_devis_reglement_text: org.pdf_devis_reglement_text || '',
      pdf_devis_cgv_text: org.pdf_devis_cgv_text || '',
    })
  }

  const siren = computeSiren(draft.siret)

  return (
    <div className="space-y-4">
      {/* ── Barre d'action sticky ─────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 -mx-6 px-6 py-3 flex items-center justify-between border-b backdrop-blur"
        style={{ background: 'var(--bg)', borderColor: 'var(--brd-sub)' }}
      >
        <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
          Ces informations apparaissent dans vos PDFs (devis, livrables, bilans) et
          sur les pages de partage envoyées à vos clients.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty || saving}
            className="btn-secondary btn-sm"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="btn-primary btn-sm"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* ── 1. Identité commerciale ───────────────────────────────────── */}
      <Section
        icon={<Briefcase className="w-4 h-4" />}
        title="Identité commerciale"
        open={openSections.commercial}
        onToggle={() => toggle('commercial')}
      >
        <Field label="Nom commercial" required>
          <input
            type="text"
            className="input text-sm w-full"
            placeholder="Nom court de votre société"
            value={draft.display_name}
            onChange={(e) => set('display_name', e.target.value)}
          />
        </Field>
        <Field label="Slogan / sous-titre" hint="Affiché en footer PDF et page partage client">
          <input
            type="text"
            className="input text-sm w-full"
            placeholder="Ex : Production audiovisuelle"
            value={draft.tagline}
            onChange={(e) => set('tagline', e.target.value)}
          />
        </Field>
        <Field label="Site web">
          <input
            type="url"
            className="input text-sm w-full"
            placeholder="https://votre-site.com"
            value={draft.website_url}
            onChange={(e) => set('website_url', e.target.value)}
          />
        </Field>
      </Section>

      {/* ── 2. Identité légale ────────────────────────────────────────── */}
      <Section
        icon={<FileText className="w-4 h-4" />}
        title="Identité légale"
        subtitle="Le toggle indique l'affichage dans les pieds de page PDF"
        open={openSections.legal}
        onToggle={() => toggle('legal')}
      >
        {LEGAL_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            required={f.required}
            toggleVisibility={
              <Toggle
                value={Boolean(draft.pdf_field_visibility?.[f.key])}
                onChange={(v) => setVis(f.key, v)}
              />
            }
          >
            <input
              type="text"
              className="input text-sm w-full"
              placeholder={f.placeholder}
              value={draft[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </Field>
        ))}
        <Field
          label="N° SIREN"
          hint="Calculé automatiquement depuis le SIRET (9 premiers chiffres)"
          toggleVisibility={
            <Toggle
              value={Boolean(draft.pdf_field_visibility?.siren)}
              onChange={(v) => setVis('siren', v)}
            />
          }
        >
          <input
            type="text"
            className="input text-sm w-full"
            value={siren || '—'}
            readOnly
            disabled
            style={{ color: 'var(--txt-2)' }}
          />
        </Field>
      </Section>

      {/* ── 3. Coordonnées ────────────────────────────────────────────── */}
      <Section
        icon={<MapPin className="w-4 h-4" />}
        title="Coordonnées"
        open={openSections.contact}
        onToggle={() => toggle('contact')}
      >
        <Field label="Adresse">
          <textarea
            className="input text-sm w-full resize-y min-h-[60px]"
            placeholder="Rue, code postal, ville"
            value={draft.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Email contact">
            <input
              type="email"
              className="input text-sm w-full"
              placeholder="contact@..."
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Téléphone">
            <input
              type="tel"
              className="input text-sm w-full"
              placeholder="+33 ..."
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {/* ── 4. Branding visuel ────────────────────────────────────────── */}
      <Section
        icon={<ImageIcon className="w-4 h-4" />}
        title="Branding visuel"
        open={openSections.branding}
        onToggle={() => toggle('branding')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ImageUploader
            orgId={org.id}
            kind="logo-clair"
            label="Logo (fond clair)"
            hint="Utilisé sur l'UI lightmode et les PDFs blancs"
            currentUrl={draft.logo_url_clair}
            onChange={(url) => set('logo_url_clair', url)}
            previewBg="#ffffff"
          />
          <ImageUploader
            orgId={org.id}
            kind="logo-sombre"
            label="Logo (fond sombre)"
            hint="Utilisé sur l'UI darkmode et les hero immersifs"
            currentUrl={draft.logo_url_sombre}
            onChange={(url) => set('logo_url_sombre', url)}
            previewBg="#0f172a"
          />
        </div>
        <ImageUploader
          orgId={org.id}
          kind="logo-banner"
          label="Logo bannière (en-tête PDF)"
          hint="Version horizontale du logo, utilisée en en-tête de tous les PDFs (devis, facture, bilan…)"
          currentUrl={draft.logo_banner_url}
          onChange={(url) => set('logo_banner_url', url)}
          previewBg="#ffffff"
        />
        <ImageUploader
          orgId={org.id}
          kind="signature"
          label="Signature du producteur"
          hint="Apparaît en bas des PDFs livrables et devis. Idéalement PNG transparent."
          currentUrl={draft.signature_url}
          onChange={(url) => set('signature_url', url)}
          previewBg="#ffffff"
        />
        <Field label="Couleur de marque" hint="Utilisée comme accent UI et dans les headers PDF">
          <div className="flex items-center gap-2 flex-wrap">
            {BRAND_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('brand_color', c)}
                className="w-8 h-8 rounded-lg transition-transform hover:scale-110"
                style={{
                  background: c,
                  border: draft.brand_color?.toLowerCase() === c.toLowerCase()
                    ? '3px solid var(--txt)'
                    : '2px solid var(--brd)',
                }}
                title={c}
              />
            ))}
            <div className="ml-2 flex items-center gap-2">
              <input
                type="color"
                value={draft.brand_color || '#3B82F6'}
                onChange={(e) => set('brand_color', e.target.value.toUpperCase())}
                className="w-8 h-8 rounded cursor-pointer"
                style={{ border: '1px solid var(--brd)' }}
                title="Choisir une couleur personnalisée"
              />
              <input
                type="text"
                className="input text-xs font-mono w-24"
                placeholder="#3B82F6"
                value={draft.brand_color || ''}
                onChange={(e) => set('brand_color', e.target.value.toUpperCase())}
                maxLength={7}
              />
            </div>
          </div>
        </Field>
      </Section>

      {/* ── 5. Page de partage client ─────────────────────────────────── */}
      <Section
        icon={<Share2 className="w-4 h-4" />}
        title="Page de partage client"
        open={openSections.share}
        onToggle={() => toggle('share')}
      >
        <Field
          label="Message d'accueil"
          hint="Affiché en haut de la page de suivi des livrables envoyée à vos clients (laisser vide = pas de message)"
        >
          <textarea
            className="input text-sm w-full resize-y min-h-[100px]"
            placeholder="Bienvenue sur le suivi de votre projet…"
            value={draft.share_intro_text}
            onChange={(e) => set('share_intro_text', e.target.value)}
          />
        </Field>
      </Section>

      {/* ── 6. Mentions devis ────────────────────────────────────────── */}
      <Section
        icon={<Receipt className="w-4 h-4" />}
        title="Mentions devis"
        subtitle="Textes affichés dans le pied de page de vos devis. Laisser vide pour masquer un bloc."
        open={openSections.devis}
        onToggle={() => toggle('devis')}
      >
        <Field label="Annulation / report">
          <textarea
            className="input text-sm w-full resize-y min-h-[80px]"
            placeholder="Conditions d'annulation ou de report du tournage…"
            value={draft.pdf_devis_annulation_text}
            onChange={(e) => set('pdf_devis_annulation_text', e.target.value)}
          />
        </Field>
        <Field
          label="Modalités de règlement"
          hint="Les conditions d'acompte (% et montant calculé) sont injectées automatiquement par le devis avant ce texte. Mettez ici uniquement les règles fixes : solde, majoration, etc."
        >
          <textarea
            className="input text-sm w-full resize-y min-h-[80px]"
            placeholder="Solde sous 30 jours, majoration en cas de retard…"
            value={draft.pdf_devis_reglement_text}
            onChange={(e) => set('pdf_devis_reglement_text', e.target.value)}
          />
        </Field>
        <Field
          label="CGV"
          hint="Mention légale renvoyant vers vos conditions générales de vente"
        >
          <textarea
            className="input text-sm w-full resize-y min-h-[80px]"
            placeholder="Toute commande est soumise à l'acceptation de nos CGV, consultables sur…"
            value={draft.pdf_devis_cgv_text}
            onChange={(e) => set('pdf_devis_cgv_text', e.target.value)}
          />
        </Field>
      </Section>
    </div>
  )
}

// ─── Composants utilitaires ─────────────────────────────────────────────────

function Section({ icon, title, subtitle, open, onToggle, children }) {
  return (
    <div className="card overflow-visible">
      <button
        type="button"
        onClick={onToggle}
        className="w-full card-header flex items-center justify-between hover:bg-gray-50 transition-colors"
        style={{ background: 'transparent' }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span style={{ color: 'var(--txt-3)' }}>{icon}</span>
          <div className="min-w-0">
            <h2
              className="text-xs font-bold uppercase tracking-widest text-left"
              style={{ color: 'var(--txt-2)' }}
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-[11px] mt-0.5 text-left" style={{ color: 'var(--txt-3)' }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
        )}
      </button>
      {open && <div className="p-5 space-y-3">{children}</div>}
    </div>
  )
}

function Field({ label, hint, required, toggleVisibility, children }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium" style={{ color: 'var(--txt-2)' }}>
          {label}
          {required && <span className="ml-1" style={{ color: 'var(--red)' }}>*</span>}
        </label>
        {toggleVisibility}
      </div>
      {children}
      {hint && (
        <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0"
      style={{
        background: value ? 'var(--green)' : 'var(--brd)',
      }}
      title={value ? 'Visible dans les PDFs' : 'Masqué dans les PDFs'}
    >
      <span
        className="inline-block w-3.5 h-3.5 bg-white rounded-full transform transition-transform"
        style={{ transform: value ? 'translateX(18px)' : 'translateX(3px)' }}
      />
    </button>
  )
}

// ─── Uploader d'image vers le bucket org-assets ─────────────────────────────
function ImageUploader({ orgId, kind, label, hint, currentUrl, onChange, previewBg }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file || !orgId) return
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit être une image PNG ou JPG.')
      return
    }
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      setError('Format autorisé : PNG ou JPG uniquement.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image trop lourde (max 5 Mo).')
      return
    }
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${orgId}/${kind}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('org-assets')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('org-assets').getPublicUrl(path)
      onChange(pub.publicUrl)
    } catch (e) {
      setError(e.message || "Erreur lors de l'upload.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium" style={{ color: 'var(--txt-2)' }}>
        {label}
      </label>
      <div className="flex items-stretch gap-3">
        {/* Aperçu */}
        <div
          className="w-24 h-24 rounded-lg shrink-0 flex items-center justify-center overflow-hidden"
          style={{
            background: previewBg,
            border: '1px solid var(--brd)',
          }}
        >
          {currentUrl ? (
            <img
              src={currentUrl}
              alt={label}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <ImageIcon className="w-8 h-8 opacity-30" />
          )}
        </div>
        {/* Boutons */}
        <div className="flex-1 flex flex-col justify-center gap-2 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn-secondary btn-sm"
            >
              {uploading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {currentUrl ? 'Remplacer' : 'Uploader'}
            </button>
            {currentUrl && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="btn-secondary btn-sm"
                style={{ color: 'var(--red)' }}
                title="Retirer le visuel"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {hint && (
            <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
              {hint}
            </p>
          )}
          {error && (
            <p
              className="text-[11px] flex items-center gap-1"
              style={{ color: 'var(--red)' }}
            >
              <AlertCircle className="w-3 h-3" />
              {error}
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  )
}

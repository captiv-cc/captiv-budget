// ════════════════════════════════════════════════════════════════════════════
// DossierModal — création et réglages d'un dossier d'embauches
// ════════════════════════════════════════════════════════════════════════════
//
// Le mode de facturation est demandé À LA CRÉATION, sans valeur par défaut :
// appliquer 80 % à un projet interne gonflerait un coût qu'on veut au réel.
// Une fois posé il reste modifiable, mais jamais deviné.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Save, Link2, ExternalLink } from 'lucide-react'
import SearchSelect from '../../components/SearchSelect'
import DayPicker from '../../components/DayPicker'
import { supabase } from '../../lib/supabase'
import { notify } from '../../lib/notify'
import { CONVENTIONS, MODES, STATUTS_DOSSIER, conventionKey } from '../../lib/embauches'
import { createDossier, updateDossier } from '../../lib/embauchesData'
import { Champ, Txt } from './ui'
import { inputStyle, selectStyle } from './styles'

// Portail employeur France Travail : c'est là que se récupère le numéro
// d'objet d'un contrat. URL fournie par Hugo (connexion employeur).
const URL_FRANCE_TRAVAIL =
  'https://authentification-pro.francetravail.fr/connexion/XUI/?realm=/employeur&goto=https://authentification-pro.francetravail.fr/connexion/oauth2/employeur/authorize?realm%3D/employeur%26response_type%3Dcode%26client_id%3DENT_PO018-PORTAILENTREPRISE_C2356069E9D1E79CA924378153CFBBFB4D4416B1F99D41A2940BFDB66C5319DB%26scope%3Dopenid%2520profile%2520email%2520application_ENT_PO018-PORTAILENTREPRISE%2520rechercheProfil%2520logW%26redirect_uri%3Dhttps://pro.francetravail.fr/accueil/auth/auth.html%26state%3D0gI6Lp5iD4HNArBWU1dl8g%26nonce%3DhUBEf9CQ2aZj0C3nGbMZaw#login/'

export default function DossierModal({ dossier = null, orgId, projectId = null, onClose, onSaved }) {
  const creation = !dossier?.id

  const [form, setForm] = useState(() => ({
    nom: dossier?.nom || '',
    mode: dossier?.mode || null, // pas de défaut : choix explicite
    coef_vente: dossier?.coef_vente ?? 0.8,
    client_id: dossier?.client_id || null,
    project_id: dossier?.project_id || projectId || null,
    convention: conventionKey(dossier?.convention) || '2642',
    type_projet: dossier?.type_projet || '',
    numero_objet: dossier?.numero_objet || '',
    bon_commande: dossier?.bon_commande || '',
    lieu: dossier?.lieu || '',
    resume: dossier?.resume || '',
    statut: dossier?.statut || 'en_cours',
    date_debut: dossier?.date_debut || null,
    date_fin: dossier?.date_fin || null,
    notes: dossier?.notes || '',
  }))
  const [clients, setClients] = useState([])
  const [projets, setProjets] = useState([])
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Un projet appartient à un client : choisir un client restreint la liste,
  // et un projet déjà posé qui ne lui appartient pas est retiré plutôt que
  // laissé en contradiction avec le reste du dossier.
  function setClient(v) {
    setForm((f) => {
      const projet = projets.find((p) => p.id === f.project_id)
      const garde = !v || !projet || projet.client_id === v
      return { ...f, client_id: v, project_id: garde ? f.project_id : null }
    })
  }

  const projetsVisibles = useMemo(
    () => (form.client_id ? projets.filter((p) => p.client_id === form.client_id) : projets),
    [projets, form.client_id],
  )

  useEffect(() => {
    if (!orgId) return
    // Noms de colonnes réels : un client s'appelle `nom_commercial`, un projet
    // `title`, et l'archivage passe par `archived_at` (pas par `status`).
    supabase
      .from('clients')
      .select('id, nom_commercial')
      .eq('org_id', orgId)
      .order('nom_commercial')
      .then(({ data, error }) => {
        if (error) console.error('[embauches] clients:', error)
        setClients(data || [])
      })
    supabase
      .from('projects')
      .select('id, title, client_id')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('title')
      .then(({ data, error }) => {
        if (error) console.error('[embauches] projets:', error)
        setProjets(data || [])
      })
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
              <SearchSelect
                value={form.client_id}
                options={clients.map((c) => ({ value: c.id, label: c.nom_commercial }))}
                onChange={(v) => setClient(v)}
                placeholder="Aucun (suivi interne)"
                allowCreate={false}
                style={selectStyle}
              />
            </Champ>
            <Champ
              label="Projet du Desk"
              aide={
                form.client_id
                  ? 'Projets du client choisi.'
                  : 'Optionnel : le dossier peut vivre seul.'
              }
            >
              <SearchSelect
                value={form.project_id}
                options={projetsVisibles.map((p) => ({ value: p.id, label: p.title }))}
                onChange={(v) => set('project_id', v)}
                placeholder="Aucun"
                allowCreate={false}
                style={selectStyle}
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
                <SearchSelect
                  value={conventionKey(form.convention) || ''}
                  options={CONVENTIONS.map((c) => ({ value: c.key, label: c.label }))}
                  onChange={(v) => v && set('convention', v)}
                  placeholder="Choisir une convention"
                  allowCreate={false}
                  clearable={false}
                  style={selectStyle}
                />
              </Champ>
              <Champ label="Type de projet">
                <Txt
                  value={form.type_projet}
                  onChange={(v) => set('type_projet', v)}
                  placeholder="Captation"
                />
              </Champ>
              <Champ
                label="Numéro d'objet"
                action={
                  <a
                    href={URL_FRANCE_TRAVAIL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="Ouvrir le portail employeur France Travail"
                    style={{ color: 'var(--blue)', display: 'inline-flex' }}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                }
              >
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
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--txt-3)' }}>
              Suivi
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Champ label="BC / Réf. projet" aide="Référence côté client.">
                <Txt value={form.bon_commande} onChange={(v) => set('bon_commande', v)} />
              </Champ>
              <Champ label="Statut">
                <SearchSelect
                  value={form.statut}
                  options={STATUTS_DOSSIER.map((st) => ({ value: st.key, label: st.label }))}
                  onChange={(v) => v && set('statut', v)}
                  allowCreate={false}
                  clearable={false}
                  style={selectStyle}
                />
              </Champ>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Champ label="Début" aide="Facultatif : les dates servent au classement.">
                <DayPicker
                  value={form.date_debut}
                  onChange={(v) => set('date_debut', v)}
                  placeholder="Non précisé"
                  block
                  clearable
                />
              </Champ>
              <Champ label="Fin">
                <DayPicker
                  value={form.date_fin}
                  onChange={(v) => set('date_fin', v)}
                  placeholder="Non précisé"
                  block
                  clearable
                />
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

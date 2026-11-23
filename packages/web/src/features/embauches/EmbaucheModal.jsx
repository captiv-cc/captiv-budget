// ════════════════════════════════════════════════════════════════════════════
// EmbaucheModal — fiche d'une embauche : poste, jours, majorations, frais
// ════════════════════════════════════════════════════════════════════════════
//
// Calquée sur le configurateur Movinmotion pour que le report soit direct :
// mêmes unités, mêmes paliers, même convention sur les heures. S'y ajoute le
// mode horaires (9 h → 19 h), qui déduit les heures et la part de nuit.
//
// ⚠️ Les heures supplémentaires sont INCLUSES dans le total des heures, comme
// chez Movinmotion. Le bandeau de totaux affiche donc le brut complet, et les
// majorations ne comptent que leur part supplémentaire.
//
// Le bloc « Coût réel » n'apparaît que si la base a servi une ligne de coût :
// la RLS la refuse aux non-admins. Pas de garde côté front à maintenir.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  X, Plus, Trash2, Clock, CalendarDays, Receipt, Wallet, Loader2, Save,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import CustomSelect from '../../components/CustomSelect'
import JoursCalendrier from './JoursCalendrier'
import MinimaHint from './MinimaHint'
import { notify } from '../../lib/notify'
import { fmtEur } from '../../lib/cotisations'
import {
  UNITES_TAUX, TYPES_OEUVRE, TYPES_FRAIS,
  TAUX_HEURES_SUP, TAUX_AUTRES_MAJOREES,
  computeEmbauche, buildJours, suggestHeuresSup, lundiDeLaSemaine,
  heuresFromHoraires, natureForDate, feriesSet, nomEmbauche, round2,
} from '../../lib/embauches'
import {
  createEmbauche, updateEmbauche, saveJours, saveMajorations, saveFrais, saveCout,
} from '../../lib/embauchesData'

// ─── Petits blocs ───────────────────────────────────────────────────────────

function Section({ icon: Icon, titre, aide, children, action }) {
  return (
    <section
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />}
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              {titre}
            </h3>
            {aide && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                {aide}
              </p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Champ({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-medium mb-1" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

function Txt({ value, onChange, placeholder, type = 'text', ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none"
      style={inputStyle}
      {...rest}
    />
  )
}

function Nombre({ value, onChange, step = '0.5', min = '0', ...rest }) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="w-full px-2 py-1.5 rounded-lg text-sm text-right outline-none tabular-nums"
      style={inputStyle}
      {...rest}
    />
  )
}

function Jalon({ actif, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium"
      style={{
        background: actif ? 'rgba(0,200,117,.12)' : 'var(--bg-elev)',
        color: actif ? 'var(--green)' : 'var(--txt-3)',
        border: `1px solid ${actif ? 'rgba(0,200,117,.3)' : 'var(--brd)'}`,
      }}
    >
      <span
        className="w-3.5 h-3.5 rounded flex items-center justify-center text-[9px]"
        style={{
          background: actif ? 'var(--green)' : 'transparent',
          border: actif ? 'none' : '1px solid var(--brd)',
          color: '#fff',
        }}
      >
        {actif ? '✓' : ''}
      </span>
      {label}
    </button>
  )
}

const JOUR_COURT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
function libelleJour(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${JOUR_COURT[d.getUTCDay()]} ${iso.slice(8)}/${iso.slice(5, 7)}`
}

// ─── Modale ─────────────────────────────────────────────────────────────────

export default function EmbaucheModal({
  embauche = null,
  dossier,
  params,
  onClose,
  onSaved,
}) {
  const creation = !embauche?.id
  // La policy `embauche_couts_write` n'accepte que les admins. En mode frais
  // réels un gestionnaire LIT la ligne de coût sans pouvoir l'écrire : sans
  // ce flag, on lui offrirait des champs dont l'enregistrement échouerait.
  const { isAdmin } = useAuth()

  const [form, setForm] = useState(() => ({
    nom: embauche?.nom || '',
    prenom: embauche?.prenom || '',
    email: embauche?.email || '',
    telephone: embauche?.telephone || '',
    contact_id: embauche?.contact_id || null,
    poste_france_travail: embauche?.poste_france_travail || '',
    libelle_poste: embauche?.libelle_poste || '',
    statut_categoriel: embauche?.statut_categoriel || '',
    type_oeuvre: embauche?.type_oeuvre || null,
    taux: embauche?.taux ?? 0,
    unite_taux: embauche?.unite_taux || 'jour_8h',
    coef_vente: embauche?.coef_vente ?? null,
    infos_recues: Boolean(embauche?.infos_recues),
    contrat_fait: Boolean(embauche?.contrat_fait),
    contrat_signe: Boolean(embauche?.contrat_signe),
    frais_dossier_actif: embauche?.frais_dossier_actif !== false,
    frais_dossier_facture: embauche?.frais_dossier_facture ?? null,
    remarques: embauche?.remarques || '',
  }))

  const [jours, setJours] = useState(() => embauche?.jours || [])
  const [majorations, setMajorations] = useState(() => embauche?.majorations || [])
  const [frais, setFrais] = useState(() => embauche?.frais || [])
  const [cout, setCout] = useState(() => embauche?.cout || null)
  const [modeHoraires, setModeHoraires] = useState(
    () => (embauche?.jours || []).some((j) => j.heure_debut),
  )
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Esc ferme, sauf si un champ est en cours d'édition.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const feries = useMemo(
    () => feriesSet(jours.map((j) => j.date_jour), params?.feries_extra),
    [jours, params],
  )

  const totaux = useMemo(
    () =>
      computeEmbauche({
        embauche: form,
        jours,
        majorations,
        frais,
        dossier,
        params,
        cout,
      }),
    [form, jours, majorations, frais, dossier, params, cout],
  )

  // ── Jours ────────────────────────────────────────────────────────────────

  function toggleJour(iso) {
    setJours((prev) => {
      const existe = prev.some((j) => j.date_jour === iso)
      if (existe) return prev.filter((j) => j.date_jour !== iso)
      const next = buildJours(
        [...prev.map((j) => j.date_jour), iso],
        prev,
        params,
      )
      return next
    })
  }

  function toggleBeaucoup(dates, ajouter) {
    setJours((prev) => {
      if (!ajouter) {
        const aRetirer = new Set(dates)
        return prev.filter((j) => !aRetirer.has(j.date_jour))
      }
      return buildJours([...prev.map((j) => j.date_jour), ...dates], prev, params)
    })
  }

  function majJour(iso, patch) {
    setJours((prev) =>
      prev.map((j) => {
        if (j.date_jour !== iso) return j
        const next = { ...j, ...patch }
        // Les horaires font foi dès qu'ils sont complets : on en déduit les
        // heures et la nuit plutôt que de laisser deux sources diverger.
        if (patch.heure_debut !== undefined || patch.heure_fin !== undefined) {
          if (next.heure_debut && next.heure_fin) {
            const calc = heuresFromHoraires(next.heure_debut, next.heure_fin, params)
            next.heures = calc.heures
            next.heures_nuit = calc.heuresNuit
          }
        }
        return next
      }),
    )
  }

  function appliquerPartout(heures) {
    setJours((prev) => prev.map((j) => ({ ...j, heures })))
  }

  // ── Majorations ──────────────────────────────────────────────────────────

  const semaines = useMemo(() => {
    const s = new Set(jours.map((j) => lundiDeLaSemaine(j.date_jour)))
    return [...s].sort()
  }, [jours])

  function valeurMaj(kind, semaine, taux) {
    return (
      majorations.find(
        (m) => m.kind === kind && m.taux === taux && (m.semaine || null) === (semaine || null),
      )?.heures ?? ''
    )
  }

  function setMaj(kind, semaine, taux, heures) {
    setMajorations((prev) => {
      const autres = prev.filter(
        (m) =>
          !(m.kind === kind && m.taux === taux && (m.semaine || null) === (semaine || null)),
      )
      if (!heures) return autres
      return [...autres, { kind, semaine: semaine || null, taux, heures: Number(heures) }]
    })
  }

  function proposerHeuresSup() {
    const propositions = suggestHeuresSup(jours, params)
    if (propositions.length === 0) {
      notify.info('Aucune semaine ne dépasse le seuil.')
      return
    }
    setMajorations((prev) => {
      const sansSup125 = prev.filter((m) => !(m.kind === 'sup' && m.taux === 125))
      return [
        ...sansSup125,
        ...propositions.map((p) => ({
          kind: 'sup',
          semaine: p.semaine,
          taux: 125,
          heures: p.heures,
        })),
      ]
    })
    notify.success('Proposition appliquée, à corriger si la convention en dispose autrement.')
  }

  // ── Frais ────────────────────────────────────────────────────────────────

  function ajouterFrais() {
    setFrais((prev) => [
      ...prev,
      { type: 'repas', libelle: '', montant: 0, nombre: 1, soumis_cotisations: false },
    ])
  }

  function majFrais(i, patch) {
    setFrais((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f
        const next = { ...f, ...patch }
        // Le type porte sa nature par défaut : une prime est soumise, un
        // défraiement ne l'est pas.
        if (patch.type) {
          next.soumis_cotisations =
            TYPES_FRAIS.find((t) => t.key === patch.type)?.soumis ?? false
        }
        return next
      }),
    )
  }

  // ── Enregistrement ───────────────────────────────────────────────────────

  async function enregistrer() {
    if (!form.nom?.trim() && !form.prenom?.trim()) {
      notify.error('Il faut au moins un nom.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        taux: Number(form.taux) || 0,
        dossier_id: dossier.id,
      }
      const ligne = creation
        ? await createEmbauche(payload)
        : await updateEmbauche(embauche.id, payload)

      await Promise.all([
        saveJours(ligne.id, jours),
        saveMajorations(ligne.id, majorations),
        saveFrais(ligne.id, frais),
      ])

      // Le coût ne part que si la base nous l'a servi ET qu'on peut l'écrire.
      if (cout && isAdmin) {
        await saveCout(ligne.id, {
          cout_reel_mm: cout.cout_reel_mm ?? null,
          cout_reel_source: cout.cout_reel_mm != null ? 'movinmotion' : 'estime',
          frais_dossier_cout: cout.frais_dossier_cout ?? null,
          note: cout.note ?? null,
        })
      }

      notify.success(creation ? 'Embauche créée.' : 'Embauche enregistrée.')
      onSaved?.()
      onClose?.()
    } catch (err) {
      console.error('[embauches] enregistrer:', err)
      notify.error('Enregistrement : ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  const modeFraisReels = dossier?.mode === 'frais_reels'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,.5)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className="w-full max-w-5xl rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--brd)',
          maxHeight: 'calc(100vh - 2rem)',
        }}
      >
        {/* En-tête */}
        <header
          className="flex items-center justify-between gap-3 px-5 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd)' }}
        >
          <div className="min-w-0">
            <h2 className="text-base font-bold truncate" style={{ color: 'var(--txt)' }}>
              {creation ? 'Nouvelle embauche' : nomEmbauche({ ...form, contact: embauche?.contact })}
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {dossier?.nom}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Bandeau de totaux, comme Movinmotion */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-px shrink-0"
          style={{ background: 'var(--brd-sub)' }}
        >
          {[
            { label: 'Heures', valeur: `${totaux.totalHeures} h`, sous: `${totaux.totalJours} j` },
            { label: 'Brut', valeur: fmtEur(totaux.brut), sous: `${fmtEur(totaux.tauxHoraire)}/h` },
            {
              label: 'Majorations',
              valeur: fmtEur(totaux.majorations.total),
              sous: 'incluses dans les heures',
            },
            {
              label: modeFraisReels ? 'Refacturé' : 'Facturé',
              valeur: totaux.facture == null ? '—' : fmtEur(totaux.facture),
              sous:
                totaux.marge == null
                  ? modeFraisReels
                    ? 'au coût réel'
                    : null
                  : `marge ${fmtEur(totaux.marge)}`,
            },
          ].map((c) => (
            <div key={c.label} className="px-4 py-2.5" style={{ background: 'var(--bg-surf)' }}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
                {c.label}
              </p>
              <p className="text-base font-bold tabular-nums" style={{ color: 'var(--txt)' }}>
                {c.valeur}
              </p>
              {c.sous && (
                <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                  {c.sous}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Corps — min-h-0 obligatoire pour que le scroll prenne, et les
            enfants ne doivent pas se laisser comprimer. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 [&>*]:shrink-0">
          {/* Identité + contrat */}
          <Section icon={Receipt} titre="Identité et contrat">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Champ label="Prénom">
                <Txt value={form.prenom} onChange={(v) => set('prenom', v)} />
              </Champ>
              <Champ label="Nom">
                <Txt value={form.nom} onChange={(v) => set('nom', v)} />
              </Champ>
              <Champ label="Email">
                <Txt value={form.email} onChange={(v) => set('email', v)} type="email" />
              </Champ>
              <Champ label="Téléphone">
                <Txt value={form.telephone} onChange={(v) => set('telephone', v)} />
              </Champ>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Jalon
                actif={form.infos_recues}
                onToggle={() => set('infos_recues', !form.infos_recues)}
                label="Infos reçues"
              />
              <Jalon
                actif={form.contrat_fait}
                onToggle={() => set('contrat_fait', !form.contrat_fait)}
                label="Contrat fait"
              />
              <Jalon
                actif={form.contrat_signe}
                onToggle={() => set('contrat_signe', !form.contrat_signe)}
                label="Contrat signé"
              />
            </div>
          </Section>

          {/* Poste et rémunération */}
          <Section
            icon={Wallet}
            titre="Poste et rémunération"
            aide="Vocabulaire Movinmotion, pour que le report soit direct."
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Champ label="Poste France Travail">
                <Txt
                  value={form.poste_france_travail}
                  onChange={(v) => set('poste_france_travail', v)}
                  placeholder="Décorateur"
                />
              </Champ>
              <Champ label="Libellé du poste">
                <Txt
                  value={form.libelle_poste}
                  onChange={(v) => set('libelle_poste', v)}
                  placeholder="Décorateur.rice"
                />
              </Champ>
              <Champ label="Statut catégoriel">
                <Txt
                  value={form.statut_categoriel}
                  onChange={(v) => set('statut_categoriel', v)}
                  placeholder="Technicien cadre"
                />
              </Champ>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <Champ label="Type d'œuvre">
                <CustomSelect
                  value={form.type_oeuvre || ''}
                  options={[
                    { value: '', label: 'Non précisé' },
                    ...TYPES_OEUVRE.map((t) => ({ value: t.key, label: t.label })),
                  ]}
                  onChange={(v) => set('type_oeuvre', v || null)}
                  triggerClassName="w-full px-2.5 py-1.5 rounded-lg text-sm text-left"
                  triggerStyle={inputStyle}
                />
              </Champ>
              <Champ label="Rémunération">
                <Nombre value={form.taux} onChange={(v) => set('taux', v ?? 0)} step="1" />
              </Champ>
              <Champ label="Unité">
                <CustomSelect
                  value={form.unite_taux}
                  options={UNITES_TAUX.map((u) => ({ value: u.key, label: u.label }))}
                  onChange={(v) => set('unite_taux', v)}
                  triggerClassName="w-full px-2.5 py-1.5 rounded-lg text-sm text-left"
                  triggerStyle={inputStyle}
                />
              </Champ>
            </div>

            <MinimaHint
              poste={form.poste_france_travail}
              typeOeuvre={form.type_oeuvre}
              unite={form.unite_taux}
              taux={form.taux}
              onApply={(v) => set('taux', v)}
            />

            {!modeFraisReels && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Champ label={`Coefficient de vente (dossier : ${Math.round((dossier?.coef_vente ?? 0) * 100)} %)`}>
                  <Nombre
                    value={form.coef_vente == null ? '' : form.coef_vente * 100}
                    onChange={(v) => set('coef_vente', v == null ? null : v / 100)}
                    step="1"
                    placeholder="suit le dossier"
                  />
                </Champ>
                <Champ label="Frais de dossier facturés">
                  <Nombre
                    value={form.frais_dossier_facture}
                    onChange={(v) => set('frais_dossier_facture', v)}
                    step="1"
                    placeholder={String(params?.frais_dossier_facture_defaut ?? 25)}
                    disabled={!form.frais_dossier_actif}
                  />
                </Champ>
                <div className="flex items-end">
                  <Jalon
                    actif={form.frais_dossier_actif}
                    onToggle={() => set('frais_dossier_actif', !form.frais_dossier_actif)}
                    label="Facturer les frais de dossier"
                  />
                </div>
              </div>
            )}
          </Section>

          {/* Jours */}
          <Section
            icon={CalendarDays}
            titre="Jours travaillés"
            aide="Les dimanches et les fériés sont repérés : leur majoration s'applique automatiquement."
            action={
              <button
                type="button"
                onClick={() => setModeHoraires((v) => !v)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5"
                style={{
                  background: modeHoraires ? 'var(--blue-bg)' : 'var(--bg-elev)',
                  color: modeHoraires ? 'var(--blue)' : 'var(--txt-2)',
                }}
              >
                <Clock className="w-3.5 h-3.5" />
                Horaires
              </button>
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
              <JoursCalendrier
                selection={jours.map((j) => j.date_jour)}
                onToggle={toggleJour}
                onToggleMany={toggleBeaucoup}
                feriesExtra={params?.feries_extra}
                moisInitial={dossier?.date_debut}
              />

              <div className="min-w-0">
                {jours.length === 0 ? (
                  <p className="text-sm py-8 text-center" style={{ color: 'var(--txt-3)' }}>
                    Aucun jour sélectionné.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                        {jours.length} jour{jours.length > 1 ? 's' : ''} · {totaux.totalHeures} h
                      </span>
                      <div className="flex gap-1">
                        {[7, 8, 10, 12].map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => appliquerPartout(h)}
                            className="px-2 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
                          >
                            {h} h partout
                          </button>
                        ))}
                      </div>
                    </div>

                    <div
                      className="rounded-lg overflow-hidden"
                      style={{ border: '1px solid var(--brd-sub)' }}
                    >
                      <div className="max-h-64 overflow-y-auto">
                        {jours.map((j) => {
                          const nature = j.nature || natureForDate(j.date_jour, feries)
                          const teinte =
                            nature === 'ferie'
                              ? 'rgba(255,159,10,.07)'
                              : nature === 'dimanche'
                                ? 'rgba(156,95,253,.07)'
                                : 'transparent'
                          return (
                            <div
                              key={j.date_jour}
                              className="flex items-center gap-2 px-2.5 py-1.5"
                              style={{
                                background: teinte,
                                borderTop: '1px solid var(--brd-sub)',
                              }}
                            >
                              <span
                                className="text-xs w-20 shrink-0 tabular-nums"
                                style={{ color: 'var(--txt-2)' }}
                              >
                                {libelleJour(j.date_jour)}
                              </span>

                              {nature !== 'normal' && (
                                <span
                                  className="text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0"
                                  style={{
                                    background:
                                      nature === 'ferie'
                                        ? 'rgba(255,159,10,.15)'
                                        : 'rgba(156,95,253,.15)',
                                    color: nature === 'ferie' ? 'var(--amber)' : 'var(--purple)',
                                  }}
                                >
                                  {nature === 'ferie' ? 'Férié' : 'Dimanche'}
                                </span>
                              )}

                              {modeHoraires && (
                                <>
                                  <input
                                    type="time"
                                    value={j.heure_debut || ''}
                                    onChange={(e) => majJour(j.date_jour, { heure_debut: e.target.value })}
                                    className="px-1.5 py-1 rounded text-xs outline-none"
                                    style={inputStyle}
                                  />
                                  <input
                                    type="time"
                                    value={j.heure_fin || ''}
                                    onChange={(e) => majJour(j.date_jour, { heure_fin: e.target.value })}
                                    className="px-1.5 py-1 rounded text-xs outline-none"
                                    style={inputStyle}
                                  />
                                </>
                              )}

                              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                {Number(j.heures_nuit) > 0 && (
                                  <span className="text-[10px]" style={{ color: 'var(--purple)' }}>
                                    {j.heures_nuit} h nuit
                                  </span>
                                )}
                                <div className="w-16">
                                  <Nombre
                                    value={j.heures}
                                    onChange={(v) => majJour(j.date_jour, { heures: v ?? 0 })}
                                  />
                                </div>
                                <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                                  h
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleJour(j.date_jour)}
                                  className="w-6 h-6 rounded flex items-center justify-center"
                                  style={{ color: 'var(--txt-3)' }}
                                  aria-label="Retirer ce jour"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Section>

          {/* Majorations */}
          <Section
            icon={Clock}
            titre="Heures supplémentaires et majorées"
            aide="Elles sont incluses dans le total des heures : seule leur part supplémentaire s'ajoute au brut."
            action={
              semaines.length > 0 && (
                <button
                  type="button"
                  onClick={proposerHeuresSup}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
                >
                  Proposer depuis les heures
                </button>
              )
            }
          >
            {semaines.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
                Sélectionnez des jours pour ventiler les heures supplémentaires.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: 420 }}>
                  <thead>
                    <tr>
                      <th
                        className="text-left font-medium py-1 pr-2"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        Semaine du
                      </th>
                      {TAUX_HEURES_SUP.map((t) => (
                        <th
                          key={t}
                          className="text-center font-medium py-1 px-1"
                          style={{ color: 'var(--txt-3)' }}
                        >
                          {t} %
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {semaines.map((s) => (
                      <tr key={s}>
                        <td className="py-1 pr-2 tabular-nums" style={{ color: 'var(--txt-2)' }}>
                          {s.slice(8)}/{s.slice(5, 7)}
                        </td>
                        {TAUX_HEURES_SUP.map((t) => (
                          <td key={t} className="py-1 px-1">
                            <Nombre
                              value={valeurMaj('sup', s, t)}
                              onChange={(v) => setMaj('sup', s, t, v)}
                              placeholder="0"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p
                  className="text-[11px] font-medium mt-4 mb-1"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Autres heures majorées (hors dimanche et fériés)
                </p>
                <div className="grid grid-cols-4 gap-2" style={{ maxWidth: 420 }}>
                  {TAUX_AUTRES_MAJOREES.map((t) => (
                    <Champ key={t} label={`${t} %`}>
                      <Nombre
                        value={valeurMaj('autre', null, t)}
                        onChange={(v) => setMaj('autre', null, t, v)}
                        placeholder="0"
                      />
                    </Champ>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Frais */}
          <Section
            icon={Receipt}
            titre="Frais professionnels"
            aide="Refacturés à l'identique : aucune marge n'est appliquée dessus."
            action={
              <button
                type="button"
                onClick={ajouterFrais}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1"
                style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter
              </button>
            }
          >
            {frais.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
                Aucun frais.
              </p>
            ) : (
              <div className="space-y-2">
                {frais.map((f, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="w-44">
                      <Champ label="Type">
                        <CustomSelect
                          value={f.type}
                          options={TYPES_FRAIS.map((t) => ({ value: t.key, label: t.label }))}
                          onChange={(v) => majFrais(i, { type: v })}
                          triggerClassName="w-full px-2.5 py-1.5 rounded-lg text-sm text-left"
                          triggerStyle={inputStyle}
                        />
                      </Champ>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <Champ label="Libellé">
                        <Txt
                          value={f.libelle}
                          onChange={(v) => majFrais(i, { libelle: v })}
                          placeholder="Optionnel"
                        />
                      </Champ>
                    </div>
                    <div className="w-24">
                      <Champ label="Montant">
                        <Nombre
                          value={f.montant}
                          onChange={(v) => majFrais(i, { montant: v ?? 0 })}
                          step="1"
                        />
                      </Champ>
                    </div>
                    <div className="w-20">
                      <Champ label="Nombre">
                        <Nombre
                          value={f.nombre}
                          onChange={(v) => majFrais(i, { nombre: v ?? 1 })}
                          step="1"
                        />
                      </Champ>
                    </div>
                    <div className="w-24 text-right pb-1.5">
                      <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--txt)' }}>
                        {fmtEur(round2(Number(f.montant || 0) * Number(f.nombre || 0)))}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFrais((prev) => prev.filter((_, idx) => idx !== i))}
                      className="w-8 h-8 rounded-lg flex items-center justify-center mb-0.5"
                      style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
                      aria-label="Retirer ce frais"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Coût réel — rendu seulement si la base a servi la ligne */}
          {cout && (
            <Section
              icon={Wallet}
              titre="Coût réel"
              aide={
                isAdmin
                  ? "Le total affiché par Movinmotion, frais professionnels compris. Tant qu'il est vide, le coût reste une estimation."
                  : 'Renseigné par la production. Lecture seule.'
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Champ label="Coût employeur Movinmotion">
                  <Nombre
                    value={cout.cout_reel_mm}
                    onChange={(v) => setCout((c) => ({ ...c, cout_reel_mm: v }))}
                    step="0.01"
                    placeholder={String(totaux.cout?.estime ?? '')}
                    disabled={!isAdmin}
                  />
                </Champ>
                <Champ label="Frais de dossier dus">
                  <Nombre
                    value={cout.frais_dossier_cout}
                    onChange={(v) => setCout((c) => ({ ...c, frais_dossier_cout: v }))}
                    step="1"
                    placeholder={String(params?.frais_dossier_cout_defaut ?? 20)}
                    disabled={!isAdmin}
                  />
                </Champ>
                <Champ label="Note">
                  <Txt
                    value={cout.note}
                    onChange={(v) => setCout((c) => ({ ...c, note: v }))}
                    disabled={!isAdmin}
                  />
                </Champ>
              </div>

              {totaux.cout && (
                <div
                  className="flex flex-wrap items-center gap-x-6 gap-y-1 mt-3 pt-3 text-xs"
                  style={{ borderTop: '1px solid var(--brd-sub)' }}
                >
                  <span style={{ color: 'var(--txt-3)' }}>
                    Coût total{' '}
                    <strong style={{ color: 'var(--txt)' }}>
                      {fmtEur(totaux.cout.montant)}
                    </strong>
                    {totaux.cout.estEstimation && ' (estimé)'}
                  </span>
                  {totaux.marge != null && (
                    <span style={{ color: 'var(--txt-3)' }}>
                      Marge{' '}
                      <strong
                        style={{ color: totaux.marge >= 0 ? 'var(--green)' : 'var(--red)' }}
                      >
                        {fmtEur(totaux.marge)}
                      </strong>
                      {totaux.margePct != null && ` · ${totaux.margePct} %`}
                    </span>
                  )}
                </div>
              )}
            </Section>
          )}

          <Section titre="Remarques">
            <textarea
              value={form.remarques || ''}
              onChange={(e) => set('remarques', e.target.value)}
              rows={2}
              className="w-full px-2.5 py-1.5 rounded-lg text-sm outline-none resize-y"
              style={inputStyle}
            />
          </Section>
        </div>

        {/* Pied */}
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

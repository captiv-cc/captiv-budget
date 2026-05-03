// ════════════════════════════════════════════════════════════════════════════
// MembreDrawer — Vue consolidée par membre (EQUIPE-P4.3)
// ════════════════════════════════════════════════════════════════════════════
//
// Drawer right-side qui regroupe TOUT ce qui concerne une personne sur le
// projet : ses postes (toutes les rows projet_membres associées) + sa
// logistique persona-level (présence, secteur, hébergement, chauffeur,
// arrivée, retour, notes).
//
// Cas d'usage typique : "Samuel CHIBON est Cadreur ET Directeur de production
// sur ce projet. Je veux changer son lot, son statut sur les 2 postes, sa
// présence, son hébergement — d'un seul endroit."
//
// Tous les inputs sauvegardent en autosave (blur ou onChange selon le type),
// avec optimistic update via les actions du hook useCrew. Pas de bouton
// "Save" global — c'est le pattern du reste de l'app (livrables, matériel).
//
// Accès : clic sur le nom dans une AttributionRow → onOpenMembre(row).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  X,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Trash2,
  Link2,
  GitMerge,
  Edit2,
  Check,
} from 'lucide-react'
import {
  fullNameFromPersona,
  initialsFromPersona,
  CREW_STATUTS,
  personaKey,
} from '../../../lib/crew'
import { confirm } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

// Couleurs de statut alignées sur AttributionRow / EquipeTab.STEPS
const STATUT_COLORS = {
  non_applicable: 'var(--txt-3)',
  a_integrer: 'var(--blue)',
  integre: 'var(--purple)',
  contrat_signe: 'var(--green)',
  paie_en_cours: 'var(--green)',
  paie_terminee: 'var(--amber)',
}

export default function MembreDrawer({
  open,
  onClose,
  // Persona courante — passée via la row cliquée. Le drawer recalcule
  // ses propres dérivés depuis `members` (source de vérité) en utilisant
  // personaKey pour matcher.
  personaKeyValue, // string | null
  members = [], // tous les projet_membres du projet (toutes personae)
  canEdit = true,
  // Multi-lot
  lots = [], // [{ id, title }]
  lotInfoMap = {}, // { [lotId]: { title, color } }
  lineLotMap = {}, // { [devis_line_id]: lotId } — lot dérivé via devis
  // Catégories disponibles (pour le sélecteur Catégorie par row)
  categories = [],
  // EQUIPE-PERM (2026-05) — gating fin sur la suppression. Si false (cas
  // typique : prestataire en canEdit), le bouton Retirer disparaît de
  // chaque PosteCard. La suppression reste réservée aux rôles internes.
  canDeleteMember = true,
  // Actions (depuis useCrew)
  onUpdateMember, // (id, fields) => Promise
  onUpdatePersona, // (key, fields) => Promise
  onRemoveMember, // (id) => Promise — null si pas de droit
  onDetachMember, // (id) => Promise
  // Ouvrir la modale Présence (réutilisée)
  onOpenPresence, // (persona) => void
  // Ouvrir l'AttachModal pour rattacher cette row à un autre poste de la
  // même persona (cas typique : merger 2 lignes Cadreur + Essais cams en
  // 1 seule visuellement). (row) => void
  onOpenAttach,
  // Édition d'un contact annuaire — met à jour la fiche dans la table
  // `contacts` (= source de vérité partagée par tous les projets de l'org).
  // Optionnel : si non fourni, l'identity panel annuaire reste read-only.
  // (contactId, fields) => Promise
  onUpdateContact,
}) {
  // ─── Escape pour fermer ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ─── Dérivés persona (recalculés à chaque render depuis members) ───────
  // Toutes les rows (principales + rattachées) qui partagent la même
  // persona. On garde l'ordre principal d'abord puis enfants.
  const personaRows = useMemo(() => {
    if (!personaKeyValue) return []
    return members.filter((m) => personaKey(m) === personaKeyValue)
  }, [members, personaKeyValue])

  const principalRow = useMemo(
    () => personaRows.find((r) => !r.parent_membre_id) || personaRows[0] || null,
    [personaRows],
  )
  // Tous les postes de la persona, triés : principaux d'abord, puis enfants.
  // Important : une persona peut avoir PLUSIEURS principaux (ex. Hugo Martin
  // a "1er Assistant réalisateur" et "Essais cams" tant qu'aucun n'est
  // rattaché à l'autre). Il faut tous les afficher dans le drawer pour
  // permettre à l'admin de les voir + de pouvoir rattacher l'un sous l'autre.
  const orderedPosteRows = useMemo(() => {
    const principals = personaRows.filter((r) => !r.parent_membre_id)
    const children = personaRows.filter((r) => r.parent_membre_id)
    return [...principals, ...children]
  }, [personaRows])

  // Persona "synthétique" (pour le header + les fields persona-level).
  // Source : la 1ère row, par convention les attributs persona-level sont
  // synchronisés sur toutes via bulkUpdate. On expose aussi `members:
  // personaRows` pour que les helpers fullNameFromPersona /
  // initialsFromPersona fonctionnent (ils lisent persona.members[0].prenom
  // pour les rows ad-hoc — sans contact joint).
  const persona = useMemo(() => {
    const r = principalRow || personaRows[0]
    if (!r) return null
    return {
      key: personaKeyValue,
      contact_id: r.contact_id || null,
      contact: r.contact || null,
      members: personaRows,
      prenom: r.prenom || r.contact?.prenom || '',
      nom: r.nom || r.contact?.nom || '',
      email: r.email || r.contact?.email || '',
      telephone: r.telephone || r.contact?.telephone || '',
      ville: r.contact?.ville || r.secteur || '',
      regime: r.regime || r.contact?.regime || null,
      couleur: r.couleur || null,
      // Persona-level fields (lus depuis la 1ère row)
      secteur: r.secteur || '',
      hebergement: r.hebergement || '',
      chauffeur: Boolean(r.chauffeur),
      arrival_date: r.arrival_date || '',
      arrival_time: r.arrival_time || '',
      departure_date: r.departure_date || '',
      departure_time: r.departure_time || '',
      logistique_notes: r.logistique_notes || '',
      presence_days: r.presence_days || [],
    }
  }, [principalRow, personaRows, personaKeyValue])

  if (!open || !persona) return null

  const fullName = fullNameFromPersona(persona) || '—'
  const initials = initialsFromPersona(persona) || '?'
  const isFromAnnuaire = Boolean(persona.contact_id)

  // ── Helpers ────────────────────────────────────────────────────────────

  async function handleRemoveRow(row) {
    const ok = await confirm({
      title: 'Retirer ce poste',
      message: `Retirer ${fullName} du poste « ${posteOf(row)} » ?`,
      confirmLabel: 'Retirer',
      destructive: true,
    })
    if (!ok) return
    try {
      await onRemoveMember?.(row.id)
      notify.success('Poste retiré')
    } catch (e) {
      console.error('[MembreDrawer] removeRow error:', e)
      notify.error('Retrait échoué : ' + (e?.message || e))
    }
  }

  async function handleDetachRow(row) {
    try {
      await onDetachMember?.(row.id)
      notify.success('Poste détaché')
    } catch (e) {
      console.error('[MembreDrawer] detachRow error:', e)
      notify.error('Détachement échoué : ' + (e?.message || e))
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Slide-over */}
      <aside
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(560px, 100vw)',
          background: 'var(--bg-elev)',
          borderLeft: '1px solid var(--brd)',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.25)',
        }}
        role="dialog"
        aria-label={`Détails membre — ${fullName}`}
      >
        {/* ─── Header ──────────────────────────────────────────────────── */}
        <header
          className="flex items-start gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{
              background: persona.couleur ? `#${persona.couleur}` : 'var(--blue-bg)',
              color: persona.couleur ? '#fff' : 'var(--blue)',
            }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold truncate" style={{ color: 'var(--txt)' }}>
              {fullName}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {isFromAnnuaire ? (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold"
                  style={{
                    background: 'var(--blue-bg)',
                    color: 'var(--blue)',
                    border: '1px solid var(--blue-brd)',
                  }}
                  title="Personne issue de l'annuaire de l'organisation"
                >
                  Annuaire
                </span>
              ) : (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold"
                  style={{
                    background: 'var(--bg-elev)',
                    color: 'var(--txt-3)',
                    border: '1px solid var(--brd)',
                  }}
                  title="Personne hors annuaire (renfort ponctuel)"
                >
                  Hors annuaire
                </span>
              )}
              {persona.regime && (
                <span
                  className="text-[10px]"
                  style={{ color: 'var(--txt-3)' }}
                >
                  {persona.regime}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors shrink-0"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            title="Fermer (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* ─── Body scrollable ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Identité & coordonnées :
              - Hors annuaire : champs prenom/nom/email/téléphone éditables.
                Les modifications se propagent à toutes les rows ad-hoc
                de la persona via bulkUpdate (PERSONA_LEVEL_FIELDS étendu).
              - Annuaire :
                - Si canEdit + onUpdateContact fournis → panneau éditable
                  qui met à jour la table `contacts` directement (source de
                  vérité partagée par tous les projets de l'org).
                - Sinon → affichage read-only avec hint. */}
          {isFromAnnuaire ? (
            canEdit && onUpdateContact && persona.contact_id ? (
              <AnnuaireIdentityPanel
                persona={persona}
                onUpdateContact={onUpdateContact}
              />
            ) : (
              (persona.email || persona.telephone || persona.ville) && (
                <div
                  className="rounded-md p-3 space-y-1.5 text-xs"
                  style={{
                    background: 'var(--bg-surf)',
                    border: '1px solid var(--brd-sub)',
                    color: 'var(--txt-2)',
                  }}
                >
                  {persona.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                      <span className="truncate">{persona.email}</span>
                    </div>
                  )}
                  {persona.telephone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                      <span>{persona.telephone}</span>
                    </div>
                  )}
                  {persona.ville && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                      <span>{persona.ville}</span>
                    </div>
                  )}
                  <p className="text-[10px] italic pt-1" style={{ color: 'var(--txt-3)' }}>
                    Modifiable dans l&rsquo;annuaire de l&rsquo;organisation.
                  </p>
                </div>
              )
            )
          ) : (
            <AdhocIdentityPanel
              persona={persona}
              canEdit={canEdit}
              onUpdatePersona={onUpdatePersona}
            />
          )}

          {/* ─── Section : Postes ──────────────────────────────────────── */}
          <section>
            <SectionTitle
              icon={<User className="w-3.5 h-3.5" />}
              count={personaRows.length}
            >
              Postes sur ce projet
            </SectionTitle>
            <div className="space-y-2 mt-2">
              {/* Hint expliquant Rattacher quand 2+ postes existent. Cas
                  typique : Hugo Martin a "1er Assistant" + "Essais cams"
                  → Rattacher Essais cams → choisir 1er Assistant comme
                  parent → les 2 fusionnent en 1 ligne sur la techlist. */}
              {personaRows.length >= 2 && (
                <p
                  className="text-[10.5px] leading-snug -mt-0.5 mb-0.5"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Astuce : pour fusionner 2 postes en une seule ligne (sous-poste),
                  cliquer{' '}
                  <span style={{ color: 'var(--blue)', fontWeight: 600 }}>
                    Rattacher
                  </span>{' '}
                  sur le poste secondaire et choisir le poste principal.
                </p>
              )}
              {orderedPosteRows.map((row) => {
                const isChild = Boolean(row.parent_membre_id)
                return (
                  <PosteCard
                    key={row.id}
                    row={row}
                    isChild={isChild}
                    canEdit={canEdit}
                    // EQUIPE-PERM : la suppression d'une row est une action
                    // distincte de canEdit (un prestataire en canEdit ne
                    // peut PAS supprimer). Le bouton Retirer est masqué
                    // dans la PosteCard si canDeleteMember=false.
                    canDelete={canDeleteMember}
                    lots={lots}
                    lotInfoMap={lotInfoMap}
                    lineLotMap={lineLotMap}
                    categories={categories}
                    hasAttachCandidates={personaRows.length >= 2}
                    onUpdateMember={onUpdateMember}
                    onRemove={
                      canDeleteMember ? () => handleRemoveRow(row) : null
                    }
                    onDetach={isChild ? () => handleDetachRow(row) : null}
                    onAttach={
                      onOpenAttach && personaRows.length >= 2 && !isChild
                        ? () => {
                            onOpenAttach(row)
                            onClose?.()
                          }
                        : null
                    }
                  />
                )
              })}
            </div>
          </section>

          {/* ─── Section : Présence & secteur (persona-level) ──────────── */}
          {/* Tous les autres champs logistique (arrivée, retour, hébergement,
              chauffeur, notes logistique) sont migrés vers la future tab
              Logistique dédiée — décision Hugo P4.3.5. */}
          <section>
            <SectionTitle icon={<Calendar className="w-3.5 h-3.5" />}>
              Présence sur le projet
            </SectionTitle>
            <p className="text-[10px] italic mt-1 mb-2" style={{ color: 'var(--txt-3)' }}>
              S&rsquo;applique à TOUS les postes de cette personne.
            </p>
            <PresencePanel
              persona={persona}
              canEdit={canEdit}
              onUpdatePersona={onUpdatePersona}
              onOpenPresence={() => onOpenPresence?.(persona)}
            />
          </section>
        </div>

        {/* ─── Footer ─────────────────────────────────────────────────── */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <span className="text-[10px] mr-auto" style={{ color: 'var(--txt-3)' }}>
            Modifications enregistrées automatiquement
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Fermer
          </button>
        </footer>
      </aside>
    </>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function SectionTitle({ icon, count = null, children }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: 'var(--txt-3)' }}>{icon}</span>
      <h3
        className="text-[10px] uppercase tracking-widest font-bold"
        style={{ color: 'var(--txt-2)' }}
      >
        {children}
      </h3>
      {count != null && (
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          · {count}
        </span>
      )}
    </div>
  )
}

function posteOf(row) {
  return (
    row.devis_line?.produit ||
    row.specialite ||
    row.contact?.specialite ||
    '—'
  )
}

// ─── PosteCard — 1 row (principale ou rattachée) ─────────────────────────

function PosteCard({
  row,
  isChild,
  canEdit,
  // EQUIPE-PERM : gate fin sur la suppression. canEdit=true sans
  // canDelete (= prestataire en canEdit) → tout le reste éditable mais
  // pas le bouton Retirer.
  canDelete = true,
  lots,
  lotInfoMap,
  lineLotMap,
  categories,
  hasAttachCandidates = false,
  onUpdateMember,
  onRemove,
  onDetach,
  onAttach,
}) {
  const posteFromDevis = row.devis_line?.produit || null
  const canEditPoste = canEdit && !posteFromDevis
  const showLotSelect = lots.length >= 2

  // Lot effectif : dérivé du devis_line si présent, sinon row.lot_id direct.
  const effectiveLotId = row.devis_line_id
    ? lineLotMap[row.devis_line_id] || null
    : row.lot_id || null
  // Le lot peut être édité UNIQUEMENT pour les rows ad-hoc (sans devis_line).
  // Pour les rows liées à un devis, le lot vient du devis → modifier le devis.
  const canEditLot = canEdit && !row.devis_line_id

  const [posteDraft, setPosteDraft] = useState(row.specialite || posteFromDevis || '')
  // Sync local draft avec la row si elle change ailleurs
  useEffect(() => {
    setPosteDraft(row.specialite || posteFromDevis || '')
  }, [row.specialite, posteFromDevis])

  const lotInfo = effectiveLotId ? lotInfoMap[effectiveLotId] : null

  return (
    <div
      className="rounded-md p-3 space-y-2"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        marginLeft: isChild ? 16 : 0,
        borderLeft: isChild ? '2px solid var(--purple)' : '1px solid var(--brd-sub)',
      }}
    >
      {/* Ligne 1 : Poste + indicateurs */}
      <div className="flex items-center gap-2 flex-wrap">
        {isChild && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{
              background: 'var(--purple-bg)',
              color: 'var(--purple)',
            }}
            title="Poste rattaché au principal"
          >
            <GitMerge className="w-2.5 h-2.5" />
            Rattaché
          </span>
        )}
        {posteFromDevis ? (
          <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--txt)' }}>
            {posteFromDevis}
          </span>
        ) : canEditPoste ? (
          <input
            type="text"
            value={posteDraft}
            onChange={(e) => setPosteDraft(e.target.value)}
            onBlur={() => {
              const next = posteDraft.trim() || null
              if (next !== (row.specialite || null)) {
                onUpdateMember?.(row.id, { specialite: next })
              }
            }}
            placeholder="Poste / spécialité"
            className="text-sm font-semibold flex-1 px-2 py-1 rounded outline-none min-w-0"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          />
        ) : (
          <span className="text-sm font-semibold flex-1" style={{ color: 'var(--txt-3)' }}>
            {row.specialite || '—'}
          </span>
        )}
        {row.devis_line_id && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{
              background: 'var(--blue-bg)',
              color: 'var(--blue)',
              border: '1px solid var(--blue-brd)',
            }}
            title="Attribution liée à une ligne de devis"
          >
            <Link2 className="w-2.5 h-2.5" />
            Devis
          </span>
        )}
      </div>

      {/* Ligne 2 : Statut · Lot · Catégorie  (en grid responsive) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Statut */}
        <div>
          <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
            Statut
          </label>
          <select
            disabled={!canEdit}
            value={row.movinmotion_statut || 'non_applicable'}
            onChange={(e) => onUpdateMember?.(row.id, { movinmotion_statut: e.target.value })}
            className="w-full text-xs px-2 py-1 rounded outline-none"
            style={{
              background: 'var(--bg-elev)',
              border: `1px solid ${STATUT_COLORS[row.movinmotion_statut] || 'var(--brd)'}`,
              color: STATUT_COLORS[row.movinmotion_statut] || 'var(--txt)',
            }}
          >
            {CREW_STATUTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {/* Lot — éditable seulement pour rows ad-hoc */}
        {showLotSelect && (
          <div>
            <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
              Lot
            </label>
            {canEditLot ? (
              <select
                value={row.lot_id || ''}
                onChange={(e) =>
                  onUpdateMember?.(row.id, { lot_id: e.target.value || null })
                }
                className="w-full text-xs px-2 py-1 rounded outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              >
                <option value="">— Aucun —</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            ) : (
              <div
                className="text-xs px-2 py-1 rounded inline-flex items-center gap-1.5"
                style={{
                  background: 'var(--bg-elev)',
                  color: lotInfo?.color || 'var(--txt-3)',
                  border: `1px solid ${lotInfo?.color || 'var(--brd-sub)'}`,
                }}
                title={
                  row.devis_line_id
                    ? 'Lot dérivé de la ligne de devis (modifier le devis pour changer)'
                    : 'Aucun lot'
                }
              >
                {lotInfo ? (
                  <>
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: lotInfo.color }}
                    />
                    {lotInfo.title}
                  </>
                ) : (
                  '— Aucun —'
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ligne 3 : Catégorie + actions */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <label className="text-[10px] font-semibold" style={{ color: 'var(--txt-3)' }}>
          Catégorie
        </label>
        <select
          disabled={!canEdit}
          value={row.category || ''}
          onChange={(e) =>
            onUpdateMember?.(row.id, { category: e.target.value || null })
          }
          className="text-xs px-2 py-0.5 rounded outline-none flex-1 min-w-0"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt-2)',
          }}
        >
          <option value="">À trier</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {/* Rattacher : disponible si au moins 2 postes existent pour cette
            persona ET pour les rows non rattachées (les rattachées peuvent
            être réattachées via Détacher → Rattacher autre).
            Cohérent avec le menu kebab d'AttributionRow. */}
        {canEdit && !isChild && onAttach && hasAttachCandidates && (
          <button
            type="button"
            onClick={onAttach}
            className="text-[10px] px-2 py-0.5 rounded-md transition-colors inline-flex items-center gap-1"
            style={{
              background: 'transparent',
              color: 'var(--blue)',
              border: '1px solid var(--blue)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--blue-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="Rattacher ce poste à un autre — le poste devient enfant et n'apparaît plus comme ligne séparée."
          >
            <GitMerge className="w-2.5 h-2.5" />
            Rattacher
          </button>
        )}
        {canEdit && isChild && onDetach && (
          <button
            type="button"
            onClick={onDetach}
            className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--purple)',
              border: '1px solid var(--purple)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--purple-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="Détacher : redevient un poste principal"
          >
            Détacher
          </button>
        )}
        {/* EQUIPE-PERM : Retirer gated par canDelete (= canDeleteMember au
            niveau drawer). Un prestataire en canEdit ne peut pas voir
            ce bouton — la suppression reste réservée aux rôles internes. */}
        {canEdit && canDelete && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-[10px] px-2 py-0.5 rounded-md transition-colors inline-flex items-center gap-1"
            style={{
              background: 'transparent',
              color: 'var(--red)',
              border: '1px solid var(--red)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--red-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="Retirer ce poste de l'équipe"
          >
            <Trash2 className="w-2.5 h-2.5" />
            Retirer
          </button>
        )}
      </div>
    </div>
  )
}

// ─── PresencePanel — Présence (calendrier) + Secteur uniquement ──────────
//
// Tous les autres champs logistique (arrivée, retour, hébergement,
// chauffeur, notes logistique) sont migrés vers la future tab Logistique
// dédiée. Décision Hugo P4.3.5 : la tab Équipe se concentre sur le
// "qui fait quoi quand" ; la tab Logistique sur "comment ils arrivent /
// où ils dorment / comment on les transporte".

function PresencePanel({ persona, canEdit, onUpdatePersona, onOpenPresence }) {
  // Pré-remplissage : si la persona n'a pas de secteur projet-spécifique,
  // on affiche par défaut la ville de l'annuaire (cohérent avec
  // effectiveSecteur dans crew.js et avec ce qu'on rend dans le PDF /
  // Crew list / Share). Une fois affiché, le commit on-blur ne sauve QUE
  // si l'utilisateur a effectivement modifié la valeur (sinon on évite un
  // write inutile qui figerait la ville et casserait le fallback dynamique
  // si la fiche annuaire change plus tard).
  const initialValue = persona.secteur || persona.contact?.ville || ''
  const [secteur, setSecteur] = useState(initialValue)
  const initialRef = useRef(initialValue)

  // Sync draft si la persona change (autre tab via Realtime, ou bulk update,
  // ou si la fiche annuaire est modifiée). La ref initialValue suit aussi
  // pour que le check "valeur inchangée vs initial" reste correct.
  useEffect(() => {
    const v = persona.secteur || persona.contact?.ville || ''
    setSecteur(v)
    initialRef.current = v
  }, [persona.secteur, persona.contact?.ville])

  function commitSecteur() {
    if (!canEdit) return
    const trimmed = secteur.trim()
    // L'utilisateur n'a pas touché → ne rien commit (évite de figer la
    // ville annuaire comme secteur projet-spécifique).
    if (trimmed === initialRef.current.trim()) return
    const next = trimmed || null
    if (next === (persona.secteur || null)) return
    onUpdatePersona?.(persona.key, { secteur: next })
  }

  const presenceCount = (persona.presence_days || []).length

  return (
    <div className="space-y-3">
      {/* Présence — résumé + bouton vers PresenceCalendarModal */}
      <div
        className="rounded-md p-3 flex items-center gap-3"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
      >
        <Calendar className="w-4 h-4 shrink-0" style={{ color: 'var(--blue)' }} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold" style={{ color: 'var(--txt)' }}>
            Calendrier de présence
          </div>
          <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {presenceCount === 0
              ? 'Aucun jour renseigné'
              : `${presenceCount} jour${presenceCount > 1 ? 's' : ''} sélectionné${presenceCount > 1 ? 's' : ''}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenPresence}
          disabled={!canEdit}
          className="text-xs px-3 py-1.5 rounded-md transition-colors shrink-0"
          style={{
            background: 'var(--blue-bg)',
            color: 'var(--blue)',
            border: '1px solid var(--blue-brd)',
            cursor: canEdit ? 'pointer' : 'default',
            opacity: canEdit ? 1 : 0.5,
          }}
        >
          Modifier le calendrier
        </button>
      </div>

      {/* Secteur */}
      <Field label="Secteur" icon={<MapPin className="w-3 h-3" />}>
        <input
          type="text"
          value={secteur}
          disabled={!canEdit}
          onChange={(e) => setSecteur(e.target.value)}
          onBlur={commitSecteur}
          placeholder="Ex: Paris, Marseille…"
          className="w-full text-sm px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
      </Field>
    </div>
  )
}

function Field({ label, icon, children }) {
  return (
    <div>
      <label
        className="block text-[10px] font-semibold mb-1 inline-flex items-center gap-1"
        style={{ color: 'var(--txt-3)' }}
      >
        {icon}
        {label}
      </label>
      {children}
    </div>
  )
}

// ─── AdhocIdentityPanel — Édition identité hors annuaire ─────────────────
//
// Pour les rows ad-hoc (contact_id IS NULL), prenom/nom/email/telephone
// sont stockés directement sur projet_membres. Quand l'admin modifie ces
// champs ici, on les propage à TOUTES les rows de la persona (cf. la
// liste PERSONA_LEVEL_FIELDS étendue) pour garder la cohérence — sinon
// changer "Paul" en "Paul-Marie" sur une row casserait le groupement
// par personaKey (qui inclut prenom/nom).

function AdhocIdentityPanel({ persona, canEdit, onUpdatePersona }) {
  const [prenom, setPrenom] = useState(persona.prenom || '')
  const [nom, setNom] = useState(persona.nom || '')
  const [email, setEmail] = useState(persona.email || '')
  const [telephone, setTelephone] = useState(persona.telephone || '')

  // Sync drafts si la persona change (autre tab via Realtime, ou bulk update)
  useEffect(() => setPrenom(persona.prenom || ''), [persona.prenom])
  useEffect(() => setNom(persona.nom || ''), [persona.nom])
  useEffect(() => setEmail(persona.email || ''), [persona.email])
  useEffect(() => setTelephone(persona.telephone || ''), [persona.telephone])

  function commit(field, value, current) {
    if (!canEdit) return
    const next = value === '' ? null : value
    if (next === (current || null)) return
    onUpdatePersona?.(persona.key, { [field]: next })
  }

  return (
    <div
      className="rounded-md p-3 space-y-2"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Prénom" icon={<User className="w-3 h-3" />}>
          <input
            type="text"
            value={prenom}
            disabled={!canEdit}
            onChange={(e) => setPrenom(e.target.value)}
            onBlur={() => commit('prenom', prenom.trim(), persona.prenom)}
            placeholder="Prénom"
            className="w-full text-sm px-2 py-1 rounded outline-none"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          />
        </Field>
        <Field label="Nom" icon={<User className="w-3 h-3" />}>
          <input
            type="text"
            value={nom}
            disabled={!canEdit}
            onChange={(e) => setNom(e.target.value)}
            onBlur={() => commit('nom', nom.trim(), persona.nom)}
            placeholder="Nom"
            className="w-full text-sm px-2 py-1 rounded outline-none"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          />
        </Field>
      </div>

      <Field label="Email" icon={<Mail className="w-3 h-3" />}>
        <input
          type="email"
          value={email}
          disabled={!canEdit}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => commit('email', email.trim().toLowerCase(), persona.email)}
          placeholder="email@exemple.fr"
          className="w-full text-sm px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
      </Field>

      <Field label="Téléphone" icon={<Phone className="w-3 h-3" />}>
        <input
          type="tel"
          value={telephone}
          disabled={!canEdit}
          onChange={(e) => setTelephone(e.target.value)}
          onBlur={() => commit('telephone', telephone.trim(), persona.telephone)}
          placeholder="06…"
          className="w-full text-sm px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
      </Field>

      <p className="text-[10px] italic pt-1" style={{ color: 'var(--txt-3)' }}>
        Cette personne n&rsquo;est pas dans l&rsquo;annuaire. Vous pouvez
        éditer ses infos ici.
      </p>
    </div>
  )
}

// ─── AnnuaireIdentityPanel — Édition d'un contact annuaire ──────────────────
//
// Pour les rows liées à un contact (contact_id IS NOT NULL), les infos sont
// stockées dans la table `contacts` (source de vérité partagée par tous les
// projets de l'org). Modifier ici = modifier la fiche annuaire pour TOUS
// les projets — c'est l'effet attendu d'un changement de coordonnées.
//
// Toggle d'édition : par défaut on affiche un récap read-only (Mail/Phone/
// MapPin + valeurs). Un petit bouton crayon en haut à droite passe en
// mode édition (5 inputs : prenom, nom, email, telephone, ville). Re-clic
// sur le bouton (devenu coche) repasse en read-only.
//
// L'admin doit avoir le droit d'éditer la BDD contacts (canEdit=true côté
// MembreDrawer + onUpdateContact fourni par TechListView). Les modifs sont
// commit on-blur ; un appel à reload() se fait côté useCrew après l'update
// pour rafraîchir le join contacts.

function AnnuaireIdentityPanel({ persona, onUpdateContact }) {
  // Source de vérité = persona.contact (joint depuis projet_membres). On
  // n'utilise pas persona.email/telephone/ville (qui peuvent inclure des
  // overrides projet_membres) pour ne pas créer d'incohérence.
  const c = persona.contact || {}
  const [editing, setEditing] = useState(false)
  const [prenom, setPrenom] = useState(c.prenom || '')
  const [nom, setNom] = useState(c.nom || '')
  const [email, setEmail] = useState(c.email || '')
  const [telephone, setTelephone] = useState(c.telephone || '')
  const [ville, setVille] = useState(c.ville || '')

  // Sync drafts si la fiche contact change ailleurs (autre tab → reload)
  useEffect(() => setPrenom(c.prenom || ''), [c.prenom])
  useEffect(() => setNom(c.nom || ''), [c.nom])
  useEffect(() => setEmail(c.email || ''), [c.email])
  useEffect(() => setTelephone(c.telephone || ''), [c.telephone])
  useEffect(() => setVille(c.ville || ''), [c.ville])

  // Quand on quitte l'édition, on resync les drafts depuis la source
  // (annule les modifications non commitées en cas de toggle rapide).
  useEffect(() => {
    if (!editing) {
      setPrenom(c.prenom || '')
      setNom(c.nom || '')
      setEmail(c.email || '')
      setTelephone(c.telephone || '')
      setVille(c.ville || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  function commit(field, value, current) {
    if (!persona.contact_id) return
    const trimmed = typeof value === 'string' ? value.trim() : value
    const next = trimmed === '' ? null : trimmed
    if (next === (current || null)) return
    onUpdateContact?.(persona.contact_id, { [field]: next })
  }

  // ─── Mode read-only (par défaut) ──────────────────────────────────────
  // Reprend l'affichage compact "icone + valeur" historique. Le bouton
  // crayon est positionné en absolute top-right pour ne pas pousser le
  // contenu. On affiche le panneau même si toutes les coords sont vides
  // (pour permettre d'entrer en édition et les remplir).
  if (!editing) {
    const hasAnyInfo = c.email || c.telephone || c.ville
    return (
      <div
        className="relative rounded-md p-3 space-y-1.5 text-xs"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd-sub)',
          color: 'var(--txt-2)',
        }}
      >
        {/* Bouton crayon — icône seule, top-right */}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="absolute top-2 right-2 p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hov)'
            e.currentTarget.style.color = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
          title="Modifier les informations annuaire"
          aria-label="Modifier les informations annuaire"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>

        {hasAnyInfo ? (
          <>
            {c.email && (
              <div className="flex items-center gap-2 pr-7">
                <Mail className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
                <span className="truncate">{c.email}</span>
              </div>
            )}
            {c.telephone && (
              <div className="flex items-center gap-2 pr-7">
                <Phone className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
                <span>{c.telephone}</span>
              </div>
            )}
            {c.ville && (
              <div className="flex items-center gap-2 pr-7">
                <MapPin className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
                <span>{c.ville}</span>
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] italic pr-7" style={{ color: 'var(--txt-3)' }}>
            Aucune coordonnée renseignée. Cliquer le crayon pour en ajouter.
          </p>
        )}
      </div>
    )
  }

  // ─── Mode édition ────────────────────────────────────────────────────
  return (
    <div
      className="relative rounded-md p-3 space-y-2"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      {/* Bouton coche pour quitter l'édition (re-passe en read-only) */}
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="absolute top-2 right-2 p-1.5 rounded-md transition-colors z-[1]"
        style={{ color: 'var(--green, #10b981)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
        title="Terminer l'édition"
        aria-label="Terminer l'édition"
      >
        <Check className="w-3.5 h-3.5" />
      </button>

      <div className="grid grid-cols-2 gap-2 pr-7">
        <Field label="Prénom" icon={<User className="w-3 h-3" />}>
          <input
            type="text"
            value={prenom}
            onChange={(e) => setPrenom(e.target.value)}
            onBlur={() => commit('prenom', prenom, c.prenom)}
            placeholder="Prénom"
            className="w-full text-sm px-2 py-1 rounded outline-none"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          />
        </Field>
        <Field label="Nom" icon={<User className="w-3 h-3" />}>
          <input
            type="text"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            onBlur={() => commit('nom', nom, c.nom)}
            placeholder="Nom"
            className="w-full text-sm px-2 py-1 rounded outline-none"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
          />
        </Field>
      </div>

      <Field label="Email" icon={<Mail className="w-3 h-3" />}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => commit('email', email.toLowerCase(), c.email)}
          placeholder="email@exemple.fr"
          className="w-full text-sm px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
      </Field>

      <Field label="Téléphone" icon={<Phone className="w-3 h-3" />}>
        <input
          type="tel"
          value={telephone}
          onChange={(e) => setTelephone(e.target.value)}
          onBlur={() => commit('telephone', telephone, c.telephone)}
          placeholder="06…"
          className="w-full text-sm px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
      </Field>

      <Field label="Ville" icon={<MapPin className="w-3 h-3" />}>
        <input
          type="text"
          value={ville}
          onChange={(e) => setVille(e.target.value)}
          onBlur={() => commit('ville', ville, c.ville)}
          placeholder="Ville"
          className="w-full text-sm px-2 py-1 rounded outline-none"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
      </Field>

      <p
        className="text-[10px] italic pt-1 leading-snug"
        style={{ color: 'var(--txt-3)' }}
      >
        Ces modifications mettent à jour la fiche dans l&rsquo;annuaire de
        l&rsquo;organisation — visible sur tous les projets.
      </p>
    </div>
  )
}

/**
 * Onglet PROJET — fiche projet visuelle
 *
 * Refonte 2026-04-12 :
 *   - Mode VUE par défaut pour tous les utilisateurs (lecture seule visuelle)
 *   - Mode ÉDITION sur demande pour admin + charge_prod uniquement
 *   - Bloc Équipe groupé par personne (récap visuel des membres du projet)
 *   - Bloc Gestion des accès (admin/charge_prod) pour déléguer vers AccessTab
 *   - Détails admin repliables (ref projet, BC, date devis)
 *
 * Cette page est la première vue de TOUS les utilisateurs (admin, charge_prod,
 * coordinateur, prestataires) → elle doit résumer le projet visuellement, et
 * n'autoriser l'édition qu'aux rôles habilités.
 */
import { useState, useEffect, useRef } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import ProjectAvatar from '../../features/projets/components/ProjectAvatar'
import DateRangesInput from '../../features/projets/components/DateRangesInput'
import PeriodesRecapWidget from '../../features/projets/components/PeriodesRecapWidget'
import LivrablesProjectWidget from '../../features/livrables/components/LivrablesProjectWidget'
import {
  PERIODE_KEYS,
  PERIODE_META,
  extractPeriodes,
  hasAnyRange,
  serializePeriodesIntoMetadata,
} from '../../lib/projectPeriodes'
import { syncTournagePeriodToPlanning } from '../../lib/projectPeriodSync'
import {
  Save,
  Plus,
  Trash2,
  X,
  RefreshCw,
  Upload,
  Building2,
  Clapperboard,
  FileText,
  StickyNote,
  Users,
  Shield,
  ChevronDown,
  ChevronRight,
  Edit2,
  Mail,
  Phone,
  MapPin,
} from 'lucide-react'

// ─── Définition des champs dynamiques PROJET ─────────────────────────────────
const PROJET_FIELDS_DEF = [
  { key: 'type_projet', label: 'Type', placeholder: 'Film institutionnel, pub…', group: 'base' },
  { key: 'titre_projet', label: 'Titre', placeholder: 'Titre du film / de la prod', group: 'base' },
  { key: 'agence', label: 'Agence', placeholder: "Nom de l'agence", group: 'prod' },
  { key: 'production', label: 'Production', placeholder: 'Société de production', group: 'prod' },
  {
    key: 'production_executive',
    label: 'Production exécutive',
    placeholder: 'Société exec.',
    group: 'prod',
  },
  { key: 'realisateur', label: 'Réalisateur', placeholder: 'Nom du réalisateur', group: 'equipe' },
  { key: 'producteur', label: 'Producteur', placeholder: 'Nom du producteur', group: 'equipe' },
  {
    key: 'nb_livrables',
    label: 'Nombre de livrables',
    placeholder: 'Ex : 3',
    group: 'livrables_specs',
  },
  {
    key: 'duree_master',
    label: 'Durée master',
    placeholder: 'Ex : 3\'00"',
    group: 'livrables_specs',
  },
  {
    key: 'format_master',
    label: 'Format master',
    placeholder: 'Ex : MP4 H264, ProRes…',
    group: 'livrables_specs',
  },
  { key: 'prepa_jours', label: 'Prépa — jours', placeholder: 'Ex : 2j', group: 'planning' },
  {
    key: 'prepa_dates',
    label: 'Prépa — dates',
    placeholder: 'Ex : 01-02/05/2026',
    group: 'planning',
  },
  { key: 'tournage_jours', label: 'Tournage — jours', placeholder: 'Ex : 3j', group: 'planning' },
  {
    key: 'tournage_dates',
    label: 'Tournage — dates',
    placeholder: 'Ex : 05-07/05/2026',
    group: 'planning',
  },
  { key: 'envoi_v1', label: 'Envoi V1', placeholder: 'JJ/MM/AAAA', group: 'planning' },
  {
    key: 'livraison_master',
    label: 'Livraison MASTER',
    placeholder: 'JJ/MM/AAAA',
    group: 'planning',
  },
  { key: 'deadline', label: 'Deadline', placeholder: 'JJ/MM/AAAA', group: 'planning' },
]

const ALL_KEYS = PROJET_FIELDS_DEF.map((f) => f.key)

const EMPTY_LIVRABLE = () => ({
  id: Date.now() + Math.random(),
  nom: '',
  format: '',
  duree: '',
  livraison: '',
})

// ─── Helpers de mapping project ⇄ draft (formulaire d'édition) ───────────────
function buildDraftFromProject(project) {
  const meta = project.metadata || {}
  const fields = {}
  fields.type_projet = meta.type_projet ?? project.type_projet ?? ''
  fields.agence = meta.agence ?? project.agence ?? ''
  fields.realisateur = meta.realisateur ?? project.realisateur ?? ''
  ALL_KEYS.forEach((k) => {
    if (fields[k] === undefined) fields[k] = meta[k] ?? ''
  })

  const visible = {}
  ALL_KEYS.forEach((k) => {
    visible[k] = meta._visible?.[k] !== false
  })

  let livrables = []
  try {
    livrables = Array.isArray(project.livrables_json)
      ? project.livrables_json
      : JSON.parse(project.livrables_json || '[]')
  } catch {
    livrables = []
  }
  if (!livrables.length) livrables = [EMPTY_LIVRABLE()]

  // PROJ-PERIODES : extraction des 5 périodes structurées (avec migration
  // soft des chaînes legacy si metadata.periodes absent).
  const periodes = extractPeriodes(meta)

  return {
    title: project.title || '',
    description: project.description || '',
    ref_projet: project.ref_projet || '',
    bon_commande: project.bon_commande || '',
    date_devis: project.date_devis || '',
    client_id: project.client_id || '',
    cover_url: project.cover_url || '',
    types_projet: project.types_projet || [],
    fields,
    visible,
    periodes,
    livrables,
    noteProd: project.note_prod || '',
  }
}

function buildPayloadFromDraft(draft) {
  // PROJ-PERIODES : on sérialise les périodes structurées dans metadata
  // (clé `periodes`) ET on resync les champs legacy (tournage_dates,
  // tournage_jours, etc.) pour que ReadView et le code existant continuent
  // de fonctionner sans modification.
  const baseMetadata = { ...draft.fields, _visible: draft.visible }
  const metadata = serializePeriodesIntoMetadata(baseMetadata, draft.periodes)
  return {
    title: draft.title || null,
    description: draft.description || null,
    client_id: draft.client_id || null,
    ref_projet: draft.ref_projet,
    bon_commande: draft.bon_commande,
    date_devis: draft.date_devis || null,
    cover_url: draft.cover_url || null,
    types_projet: draft.types_projet?.length ? draft.types_projet : null,
    agence: draft.fields.agence || null,
    realisateur: draft.fields.realisateur || null,
    note_prod: draft.noteProd,
    metadata,
    livrables_json: draft.livrables,
    updated_at: new Date().toISOString(),
  }
}

// ─── Regroupement des membres par personne ───────────────────────────────────
// Si Marc est cadreur ET monteur, il apparaît une seule fois avec deux postes.
function groupMembresByPerson(membres) {
  const map = {}
  membres.forEach((m) => {
    const key = m.contact_id ? `c_${m.contact_id}` : `l_${m.id}`
    if (!map[key]) {
      map[key] = {
        key,
        contact_id: m.contact_id,
        nom: m.nom || m.contact?.nom || '',
        prenom: m.prenom || m.contact?.prenom || '',
        email: m.email || m.contact?.email || '',
        user_id: m.contact?.user_id || null,
        postes: [],
      }
    }
    const poste = (m.specialite || '').trim()
    if (poste && !map[key].postes.includes(poste)) {
      map[key].postes.push(poste)
    }
  })
  return Object.values(map).sort((a, b) =>
    `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`),
  )
}

function initials(person) {
  const a = (person.prenom || '').trim()[0] || ''
  const b = (person.nom || '').trim()[0] || ''
  return (a + b).toUpperCase() || '?'
}

function fullName(person) {
  return `${person.prenom || ''} ${person.nom || ''}`.trim() || 'Sans nom'
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function ProjetTab() {
  const { project, setProject, projectId } = useOutletContext()
  const { isAdmin, isChargeProd } = useAuth()
  const canEdit = isAdmin || isChargeProd

  // Permissions par outil (pour masquer/adapter les blocs liés aux outils
  // dont l'utilisateur n'a pas accès, ex: livrables)
  const { canSee: canSeeOutil } = useProjectPermissions(projectId)
  const canSeeLivrables = canSeeOutil('livrables')

  // Mode édition + draft local
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  // Données auxiliaires (vue)
  const [clientsList, setClientsList] = useState([])
  const [membres, setMembres] = useState([])
  const [loadingMembres, setLoadingMembres] = useState(true)
  const [accessCount, setAccessCount] = useState(null)

  // UI : section "Détails admin" repliable (ouverte par défaut en édition
  // pour ne pas l'oublier)
  const [showAdmin, setShowAdmin] = useState(true)

  // ─── Chargements ───────────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('clients')
      .select('id, nom_commercial')
      .order('nom_commercial')
      .then(({ data }) => setClientsList(data || []))
  }, [])

  useEffect(() => {
    if (!projectId) return
    setLoadingMembres(true)
    supabase
      .from('projet_membres')
      .select('*, contact:contacts(nom, prenom, email, user_id)')
      .eq('project_id', projectId)
      .then(({ data }) => {
        setMembres(data || [])
        setLoadingMembres(false)
      })
  }, [projectId])

  useEffect(() => {
    if (!projectId || !canEdit) return
    // ⚠️ project_access a une PK composite (user_id, project_id) — pas de colonne `id`.
    // On compte sur user_id pour récupérer le bon `count`.
    supabase
      .from('project_access')
      .select('user_id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .then(({ count }) => setAccessCount(count ?? 0))
  }, [projectId, canEdit])

  // ─── Actions ───────────────────────────────────────────────────────────────
  function startEdit() {
    if (!canEdit) return
    setDraft(buildDraftFromProject(project))
    setEditing(true)
  }

  function cancelEdit() {
    setDraft(null)
    setEditing(false)
  }

  async function saveEdit() {
    if (!draft || saving) return
    setSaving(true)
    const payload = buildPayloadFromDraft(draft)
    const { data, error } = await supabase
      .from('projects')
      .update(payload)
      .eq('id', projectId)
      .select('*, clients(*)')
      .single()
    if (error) {
      setSaving(false)
      notify.error('Erreur sauvegarde : ' + error.message)
      return
    }
    // PROJ-PERIODES : synchronise les events planning de type "Tournage"
    // avec les ranges saisis. Best-effort, n'échoue pas la sauvegarde si
    // ça plante (mais on prévient l'utilisateur).
    try {
      await syncTournagePeriodToPlanning({
        projectId,
        tournage: draft.periodes?.tournage || { ranges: [] },
      })
    } catch (syncErr) {
      notify.error(
        'Projet sauvegardé, mais erreur de sync planning : ' +
          (syncErr?.message || syncErr),
      )
    }
    setSaving(false)
    if (data) {
      setProject(data)
      setDraft(null)
      setEditing(false)
    }
  }

  if (!project) return null

  // ─── Rendu ────────────────────────────────────────────────────────────────
  const persons = groupMembresByPerson(membres)
  const meta = project.metadata || {}
  const get = (k) => meta[k] ?? project[k] ?? ''

  return (
    <div className="p-5 max-w-7xl mx-auto pb-16">
      {editing ? (
        <div className="max-w-4xl mx-auto space-y-4">
          <EditView
            draft={draft}
            setDraft={setDraft}
            clientsList={clientsList}
            onCancel={cancelEdit}
            onSave={saveEdit}
            saving={saving}
            showAdmin={showAdmin}
            setShowAdmin={setShowAdmin}
            projectId={projectId}
          />
        </div>
      ) : (
        // Tous les rôles : grille 3 colonnes desktop avec Équipe en colonne
        // latérale (col-start-3, row-span-N). Repli en single column sur
        // mobile/tablette.
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 items-start">
          <ReadView
            project={project}
            get={get}
            canEdit={canEdit}
            onEdit={startEdit}
            persons={persons}
            loadingMembres={loadingMembres}
            accessCount={accessCount}
            canSeeLivrables={canSeeLivrables}
          />
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE LECTURE — fiche projet visuelle
// ══════════════════════════════════════════════════════════════════════════════
function ReadView({
  project,
  get,
  canEdit,
  onEdit,
  persons,
  loadingMembres,
  accessCount,
  canSeeLivrables,
}) {
  const planningSpecs = [
    { label: 'Nb livrables', value: get('nb_livrables') },
    { label: 'Durée master', value: get('duree_master') },
    { label: 'Format master', value: get('format_master') },
  ].filter((c) => c.value)

  // PROJ-PERIODES — extraction des 5 périodes structurées (avec migration
  // soft des chaînes legacy si metadata.periodes absent).
  const periodes = extractPeriodes(project.metadata)
  const hasAnyPeriode = PERIODE_KEYS.some((k) => hasAnyRange(periodes[k]))
  const hasPlanning = planningSpecs.length > 0 || hasAnyPeriode

  // Combien de blocs prennent la colonne gauche (col-span-2) ? Nécessaire
  // pour qu'Équipe (col-span-1, latérale) span exactement le bon nombre de
  // rows et ne crée pas de trou sous le Hero. NB : `lg:row-span-full` ne
  // fonctionne pas ici car il ne spanne que les rows explicites.
  // Items potentiels :
  //   - Hero (toujours)
  //   - AdminFooter (canEdit)
  //   - Identité (toujours)
  //   - Widget Livrables (LIV-17) — si canSeeLivrables
  //   - Note de prod (canEdit && project.note_prod)
  const showLivrablesBlock = canSeeLivrables
  const leftRowCount =
    1 + // Hero
    (canEdit ? 1 : 0) + // AdminFooter
    1 + // Identité
    (showLivrablesBlock ? 1 : 0) + // Livrables
    (canEdit && project.note_prod ? 1 : 0) // Note de prod
  // Tailwind a besoin des classes literales pour les détecter :
  // lg:row-span-2 lg:row-span-3 lg:row-span-4 lg:row-span-5
  const equipeRowSpanClass =
    leftRowCount >= 5
      ? 'lg:row-span-5'
      : leftRowCount === 4
        ? 'lg:row-span-4'
        : leftRowCount === 3
          ? 'lg:row-span-3'
          : 'lg:row-span-2'

  // Hero immersif : si cover_url, affichage avec image en background +
  // overlay gradient sombre. Sinon, gradient coloré avec icône.
  const cover = project.cover_url
  const types = project.types_projet || []

  return (
    <>
      {/* ── HERO IMMERSIF ────────────────────────────────────────────────── */}
      <div
        className="relative rounded-2xl overflow-hidden lg:col-span-2"
        style={{ border: '1px solid var(--brd)' }}
      >
        {/* Background : image cover OU gradient fallback */}
        {cover ? (
          <>
            <img
              src={cover}
              alt={project.title || ''}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0.25) 80%, rgba(0,0,0,0.15) 100%)',
              }}
            />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(135deg, var(--blue) 0%, var(--purple) 100%)',
            }}
          />
        )}

        {/* Bouton Modifier flottant en haut à droite */}
        {canEdit && (
          <button
            onClick={onEdit}
            className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur transition-colors"
            style={{
              background: 'rgba(255,255,255,0.15)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.25)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
            }}
          >
            <Edit2 className="w-3.5 h-3.5" />
            Modifier
          </button>
        )}

        {/* Contenu en bas du hero — texte blanc lisible sur cover sombre */}
        <div className="relative p-6 sm:p-8 min-h-[240px] sm:min-h-[280px] flex flex-col justify-end">
          {/* Pills types projet */}
          {types.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {types.map((t) => (
                <span
                  key={t}
                  className="text-[11px] font-medium px-2.5 py-0.5 rounded-full backdrop-blur"
                  style={{
                    background: 'rgba(255,255,255,0.18)',
                    color: 'white',
                    border: '1px solid rgba(255,255,255,0.22)',
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Titre projet en grand */}
          <h1
            className="text-3xl sm:text-4xl font-bold text-white leading-tight"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
          >
            {project.title || 'Projet sans nom'}
          </h1>

          {/* Sous-titre : réalisateur · agence */}
          {(get('realisateur') || get('agence')) && (
            <p
              className="mt-2 text-sm sm:text-base font-medium"
              style={{ color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
            >
              {[
                get('realisateur') && `Réalisé par ${get('realisateur')}`,
                get('agence') && `Agence ${get('agence')}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {/* Bandeau client + ref en bas */}
          {(project.clients || project.ref_projet) && (
            <div
              className="mt-3 flex items-center gap-3 flex-wrap text-xs"
              style={{ color: 'rgba(255,255,255,0.85)' }}
            >
              {project.clients?.nom_commercial && (
                <span className="font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                  {project.clients.nom_commercial}
                </span>
              )}
              {project.ref_projet && (
                <span
                  className="font-mono px-2 py-0.5 rounded backdrop-blur"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                  }}
                >
                  {project.ref_projet}
                </span>
              )}
              {project.clients?.email && (
                <span className="flex items-center gap-1" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                  <Mail className="w-3 h-3" />
                  {project.clients.email}
                </span>
              )}
              {project.clients?.phone && (
                <span className="flex items-center gap-1" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                  <Phone className="w-3 h-3" />
                  {project.clients.phone}
                </span>
              )}
              {project.clients?.address && (
                <span className="flex items-center gap-1" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                  <MapPin className="w-3 h-3" />
                  {project.clients.address}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── DESCRIPTION (séparée du hero pour lisibilité) ────────────────── */}
      {project.description && (
        <SectionCard
          icon={<StickyNote className="w-4 h-4" />}
          title="Description"
          className="lg:col-span-2"
        >
          <p
            className="text-sm whitespace-pre-wrap leading-relaxed"
            style={{ color: 'var(--txt-2)' }}
          >
            {project.description}
          </p>
        </SectionCard>
      )}

      {/* ── FOOTER ADMIN (admin/charge_prod uniquement, juste sous le hero) ─ */}
      {canEdit && (
        <AdminFooter project={project} accessCount={accessCount} className="lg:col-span-2" />
      )}

      {/* ── IDENTITÉ (+ planning fusionné) ───────────────────────────────── */}
      <SectionCard
        icon={<Clapperboard className="w-4 h-4" />}
        title="Identité"
        className="lg:col-span-2"
      >
        <div className="space-y-5">
          {/* Tags type de projet */}
          {project.types_projet?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {project.types_projet.map((t) => (
                <span
                  key={t}
                  className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <InfoGrid
            items={[
              { label: 'Titre', value: get('titre_projet') },
              { label: 'Agence', value: get('agence') },
              { label: 'Production', value: get('production') },
              { label: 'Production exéc.', value: get('production_executive') },
              { label: 'Réalisateur', value: get('realisateur') },
              { label: 'Producteur', value: get('producteur') },
            ]}
          />

          {hasPlanning && (
            <div className="pt-4 border-t border-gray-100 space-y-4">
              {planningSpecs.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileText className="w-3 h-3 text-gray-500" />
                    <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                      Spécifications
                    </p>
                  </div>
                  <InfoGrid items={planningSpecs} />
                </div>
              )}
              {/* PROJ-PERIODES — Récap visuel des 5 périodes structurées
                  (pills colorées + total jours par période). Remplace
                  l'ancienne InfoGrid des chaînes legacy. */}
              {hasAnyPeriode && <PeriodesRecapWidget periodes={periodes} />}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── ÉQUIPE ───────────────────────────────────────────────────────── */}
      <SectionCard
        icon={<Users className="w-4 h-4" />}
        title={`Équipe${persons.length ? ` (${persons.length})` : ''}`}
        className={`lg:col-start-3 lg:row-start-1 lg:self-start ${equipeRowSpanClass}`}
        action={
          <Link
            to={`/projets/${project.id}/equipe`}
            className="text-xs font-medium transition-colors"
            style={{ color: 'var(--blue)' }}
          >
            Voir →
          </Link>
        }
      >
        {loadingMembres ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt-3)' }}>
            <RefreshCw className="w-3 h-3 animate-spin" />
            Chargement…
          </div>
        ) : persons.length === 0 ? (
          <EmptyHint>Aucun membre attribué pour le moment.</EmptyHint>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {persons.map((p) => (
              <div
                key={p.key}
                className="flex items-center gap-3 rounded-lg px-3 py-2"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd-sub)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    background: 'var(--purple-bg)',
                    color: 'var(--purple)',
                    border: '1px solid var(--purple-brd, transparent)',
                  }}
                >
                  {initials(p)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                    {fullName(p)}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
                    {p.postes.length ? (
                      p.postes.join(' · ')
                    ) : (
                      <span className="italic" style={{ color: 'var(--txt-3)', opacity: 0.7 }}>
                        Sans poste défini
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── LIVRABLES (LIV-17) ───────────────────────────────────────────── */}
      {/* Widget self-contained qui fait son propre fetch via useLivrables.
          Affiche bandeau "Prochain", 3 compteurs + top 3 prochains livrables.
          Empty state intégré si 0 livrable. Masqué si pas de droits sur
          l'outil. */}
      {canSeeLivrables && (
        <LivrablesProjectWidget
          projectId={project.id}
          className="lg:col-span-2"
        />
      )}

      {/* ── NOTE DE PROD (admin/charge_prod uniquement) ──────────────────── */}
      {canEdit && project.note_prod && (
        <SectionCard
          icon={<StickyNote className="w-4 h-4" />}
          title="Note de production / hors devis"
          className="lg:col-span-2"
        >
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {project.note_prod}
          </p>
        </SectionCard>
      )}
    </>
  )
}

// ─── Sous-composants de la vue lecture ──────────────────────────────────────

// Note : ProjectAvatar est désormais un composant partagé importé depuis
// src/features/projets/components/ProjectAvatar.jsx (réutilisé sur Projets +
// HomePage). Voir l'import en tête de fichier.

// Uploader pour le visuel projet — composant utilisé en mode édition.
// Upload vers Supabase Storage (bucket "project-covers"), path = <projectId>/<filename>.
// Met à jour le draft via onChange(url) avec l'URL publique. La persistance en
// base se fait via le bouton "Enregistrer" classique (cover_url est dans le draft).
function ProjectCoverUploader({ projectId, project, currentUrl, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file || !projectId) return
    setError(null)

    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit être une image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image trop lourde (max 5 Mo).')
      return
    }

    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${projectId}/cover-${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('project-covers')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('project-covers').getPublicUrl(path)

      onChange(pub.publicUrl)
    } catch (e) {
      console.error('Upload cover projet:', e)
      setError(e.message || "Erreur lors de l'upload.")
    } finally {
      setUploading(false)
    }
  }

  function handleRemove() {
    onChange('')
    setError(null)
  }

  // L'avatar préview reflète l'état courant (URL ou fallback initiales du draft)
  const previewProject = { ...project, cover_url: currentUrl }

  return (
    <div>
      <FieldLabel>Visuel du projet</FieldLabel>
      <div className="flex items-center gap-4">
        <ProjectAvatar project={previewProject} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
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
              {uploading ? 'Envoi…' : currentUrl ? 'Remplacer' : 'Téléverser'}
            </button>
            {currentUrl && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={uploading}
                className="btn-secondary btn-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Retirer
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-400">
            JPG, PNG ou WebP — 5 Mo max. À défaut, le logo du client (s&apos;il existe) ou les
            initiales du projet seront utilisés.
          </p>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  )
}

// Footer compact regroupant les infos admin (réf, BC, date devis)
// et l'accès délégué vers AccessTab. Visible uniquement pour admin/charge_prod.
function AdminFooter({ project, accessCount, className = '' }) {
  const adminBits = [
    project.ref_projet && { label: 'Réf', value: project.ref_projet, mono: true },
    project.bon_commande && { label: 'BC', value: project.bon_commande, mono: true },
    project.date_devis && { label: 'Devis du', value: project.date_devis },
  ].filter(Boolean)

  const accessLabel =
    accessCount === null
      ? '—'
      : accessCount === 0
        ? 'Aucun accès délégué'
        : `${accessCount} utilisateur${accessCount > 1 ? 's' : ''}`

  return (
    <div
      className={`card flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 text-xs ${className}`}
    >
      <div
        className="flex items-center gap-x-4 gap-y-1 flex-wrap"
        style={{ color: 'var(--txt-3)' }}
      >
        <Building2 className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
        {adminBits.length === 0 ? (
          <span className="italic" style={{ color: 'var(--txt-3)' }}>
            Aucune info admin renseignée
          </span>
        ) : (
          adminBits.map((b, i) => (
            <span key={b.label} className="flex items-center gap-1.5">
              <span
                className="uppercase tracking-wide text-[10px] font-semibold"
                style={{ color: 'var(--txt-3)' }}
              >
                {b.label}
              </span>
              <span className={b.mono ? 'font-mono' : ''} style={{ color: 'var(--txt)' }}>
                {b.value}
              </span>
              {i < adminBits.length - 1 && (
                <span className="ml-3" style={{ color: 'var(--brd)' }}>·</span>
              )}
            </span>
          ))
        )}
      </div>
      <Link
        to={`/projets/${project.id}/access`}
        className="flex items-center gap-1.5 transition-colors"
        style={{ color: 'var(--txt-3)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
      >
        <Shield className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
        <span>{accessLabel}</span>
        <span className="font-medium ml-1" style={{ color: 'var(--blue)' }}>Gérer →</span>
      </Link>
    </div>
  )
}

function SectionCard({ icon, title, action, children, className = '' }) {
  return (
    <div className={`card overflow-visible ${className}`}>
      <div className="card-header">
        <div className="flex items-center gap-2" style={{ color: 'var(--txt)' }}>
          <span style={{ color: 'var(--txt-3)' }}>{icon}</span>
          <h2
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--txt-3)' }}
          >
            {title}
          </h2>
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function InfoGrid({ items }) {
  const filled = items.filter((i) => i.value)
  if (!filled.length) return <EmptyHint>Aucune information renseignée.</EmptyHint>
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {filled.map((i) => (
        <div key={i.label} className="min-w-[160px]">
          <p
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--txt-3)' }}
          >
            {i.label}
          </p>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt)' }}>
            {i.value}
          </p>
        </div>
      ))}
    </div>
  )
}

function EmptyHint({ children }) {
  return (
    <p className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
      {children}
    </p>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE ÉDITION — formulaire complet (admin + charge_prod uniquement)
// ══════════════════════════════════════════════════════════════════════════════
function EditView({
  draft,
  setDraft,
  clientsList,
  onCancel,
  onSave,
  saving,
  showAdmin,
  setShowAdmin,
  projectId,
}) {
  const setA = (k, v) => setDraft((p) => ({ ...p, [k]: v }))
  const setF = (k, v) => setDraft((p) => ({ ...p, fields: { ...p.fields, [k]: v } }))

  function addLivrable() {
    setDraft((p) => ({ ...p, livrables: [...p.livrables, EMPTY_LIVRABLE()] }))
  }
  function updateLivrable(id, key, val) {
    setDraft((p) => ({
      ...p,
      livrables: p.livrables.map((l) => (l.id === id ? { ...l, [key]: val } : l)),
    }))
  }
  function deleteLivrable(id) {
    setDraft((p) => ({
      ...p,
      livrables: p.livrables.filter((l) => l.id !== id).length
        ? p.livrables.filter((l) => l.id !== id)
        : [EMPTY_LIVRABLE()],
    }))
  }

  function renderDynField(key) {
    const def = PROJET_FIELDS_DEF.find((f) => f.key === key)
    if (!def) return null
    return (
      <Field
        key={key}
        label={def.label}
        placeholder={def.placeholder}
        value={draft.fields[key] || ''}
        onChange={(v) => setF(key, v)}
      />
    )
  }

  return (
    <>
      {/* ── Barre d'actions sticky en haut ───────────────────────────────── */}
      <div className="sticky top-2 z-20 card px-4 py-2.5 flex items-center justify-between shadow-md ring-1 ring-blue-100">
        <div className="flex items-center gap-2 text-gray-700">
          <Edit2 className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold">Mode édition</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} disabled={saving} className="btn-secondary btn-sm">
            <X className="w-3.5 h-3.5" />
            Annuler
          </button>
          <button onClick={onSave} disabled={saving} className="btn-primary btn-sm">
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* ── BLOC DÉTAILS ADMIN (repliable, en 2e position pour ne pas l'oublier) ─ */}
      <div className="card overflow-visible">
        <button
          type="button"
          onClick={() => setShowAdmin((s) => !s)}
          className="w-full card-header flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-gray-700">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
              Détails admin
            </h2>
          </div>
          {showAdmin ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </button>
        {showAdmin && (
          <div className="p-5 space-y-3">
            <Field
              label="Référence projet"
              placeholder="CAPTIV-2026-001"
              value={draft.ref_projet}
              onChange={(v) => setA('ref_projet', v)}
            />
            <Field
              label="Bon de commande client"
              placeholder="N° BC / PO"
              value={draft.bon_commande}
              onChange={(v) => setA('bon_commande', v)}
            />
            <Field
              label="Date du devis"
              type="date"
              value={draft.date_devis}
              onChange={(v) => setA('date_devis', v)}
            />
          </div>
        )}
      </div>

      {/* ── BLOC IDENTITÉ ────────────────────────────────────────────────── */}
      <Block icon={<Clapperboard className="w-4 h-4" />} title="Identité">
        <div className="space-y-4">
          {/* Visuel projet (upload Supabase Storage → cover_url) */}
          <ProjectCoverUploader
            projectId={projectId}
            project={draft}
            currentUrl={draft.cover_url}
            onChange={(url) => setA('cover_url', url)}
          />
          <Field
            label="Nom du projet"
            placeholder="Titre du projet…"
            value={draft.title}
            onChange={(v) => setA('title', v)}
            big
          />
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              className="input text-sm w-full resize-y min-h-[80px]"
              placeholder="Description du projet (visible par tous les utilisateurs ayant accès)…"
              value={draft.description}
              onChange={(e) => setA('description', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Client</FieldLabel>
            <select
              className="input text-sm"
              value={draft.client_id || ''}
              onChange={(e) => setA('client_id', e.target.value)}
            >
              <option value="">— Aucun client —</option>
              {clientsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom_commercial}
                </option>
              ))}
            </select>
          </div>
          <FieldSubSection label="Général">
            {/* Tags type de projet — multi-sélection */}
            <div className="mb-3">
              <FieldLabel>Type de projet</FieldLabel>
              <div className="flex flex-wrap gap-2 mt-1">
                {['Corporate', 'Fiction', 'Publicité', 'Clip', 'Documentaire', 'Événement', 'Captation', 'Autre'].map((type) => {
                  const selected = (draft.types_projet || []).includes(type)
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        const cur = draft.types_projet || []
                        const next = cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type]
                        setA('types_projet', next)
                      }}
                      className="text-xs font-medium rounded-full px-3 py-1.5 transition-all"
                      style={
                        selected
                          ? { background: 'var(--blue-bg, #1d4ed810)', color: 'var(--blue, #3b82f6)', border: '1px solid var(--blue, #3b82f6)', opacity: 1 }
                          : { background: 'transparent', color: 'var(--txt-2, #6b7280)', border: '1px solid var(--brd-sub, #e5e7eb)' }
                      }
                    >
                      {selected && '✓ '}{type}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['titre_projet'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Production">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['agence', 'production', 'production_executive'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Équipe">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['realisateur', 'producteur'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Spécifications">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['nb_livrables', 'duree_master', 'format_master'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Planning">
            {/* PROJ-PERIODES : 5 périodes structurées (multi-ranges).
                - Le tournage est propagé en events read-only dans le planning
                  global (cf. saveEdit → syncTournagePeriodToPlanning).
                - Les compteurs *_jours sont calculés automatiquement.
                - Les anciens champs texte libre (legacy) restent maintenus
                  en arrière-plan pour rétro-compat de la ReadView. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
              {PERIODE_KEYS.map((key) => {
                const meta = PERIODE_META[key]
                return (
                  <div key={key}>
                    <FieldLabel>{meta.label}</FieldLabel>
                    <DateRangesInput
                      value={draft.periodes?.[key]}
                      onChange={(next) =>
                        setDraft((p) => ({
                          ...p,
                          periodes: { ...(p.periodes || {}), [key]: next },
                        }))
                      }
                      color={meta.color}
                      bg={meta.bg}
                      canEdit
                    />
                  </div>
                )
              })}
            </div>
          </FieldSubSection>
        </div>
      </Block>

      {/* ── BLOC LIVRABLES ───────────────────────────────────────────────── */}
      <Block
        icon={<FileText className="w-4 h-4" />}
        title="Livrables"
        actions={
          <button
            onClick={addLivrable}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-8">N°</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400">NOM</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-32">
                  FORMAT
                </th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-24">
                  DURÉE
                </th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-32">
                  LIVRAISON
                </th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {draft.livrables.map((l, i) => (
                <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                  <td className="py-1.5 px-2 text-xs text-gray-400 font-mono">{i + 1}</td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-sm"
                      value={l.nom}
                      onChange={(e) => updateLivrable(l.id, 'nom', e.target.value)}
                      placeholder="Film 3 min 16/9…"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-xs"
                      value={l.format}
                      onChange={(e) => updateLivrable(l.id, 'format', e.target.value)}
                      placeholder="MP4, MOV…"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-xs"
                      value={l.duree}
                      onChange={(e) => updateLivrable(l.id, 'duree', e.target.value)}
                      placeholder="3'00&quot;"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <input
                      className="input-cell w-full text-xs"
                      value={l.livraison}
                      onChange={(e) => updateLivrable(l.id, 'livraison', e.target.value)}
                      placeholder="01/06/2026"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <button
                      onClick={() => deleteLivrable(l.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      {/* ── BLOC NOTE DE PROD ────────────────────────────────────────────── */}
      <Block icon={<StickyNote className="w-4 h-4" />} title="Note de production / hors devis">
        <textarea
          className="w-full text-sm rounded-lg p-3 resize-none focus:outline-none focus:ring-1"
          style={{
            color: 'var(--txt)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            '--tw-ring-color': 'var(--blue)',
          }}
          rows={6}
          placeholder="Informations hors devis, contraintes techniques, budget hors-champ, remarques de production…"
          value={draft.noteProd}
          onChange={(e) => setA('noteProd', e.target.value)}
        />
      </Block>
    </>
  )
}

// ─── Composants utilitaires (formulaire) ──────────────────────────────────────
function Block({ icon, title, children, actions }) {
  return (
    <div className="card overflow-visible">
      <div className="card-header">
        <div className="flex items-center gap-2 text-gray-700">
          <span className="text-gray-400">{icon}</span>
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">{title}</h2>
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function FieldSubSection({ label, children }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-gray-100" />
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-1">
          {label}
        </span>
        <div className="h-px flex-1 bg-gray-100" />
      </div>
      {children}
    </div>
  )
}

function FieldLabel({ children }) {
  return <label className="text-xs font-medium text-gray-500 block mb-1.5">{children}</label>
}

function Field({ label, value, onChange, placeholder, type = 'text', big = false }) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input
        type={type}
        className={`input ${big ? 'text-base font-semibold text-gray-900' : 'text-sm'}`}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

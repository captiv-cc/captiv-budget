// ════════════════════════════════════════════════════════════════════════════
// embauchesData.js — accès Supabase du module Embauches
// ════════════════════════════════════════════════════════════════════════════
//
// Séparé de `embauches.js`, qui reste pur et testable. Ici, uniquement des
// requêtes. Cf. supabase/migrations/20261123a_embauches.sql.
//
// ⚠️ `embauche_couts` peut revenir VIDE sans que ce soit une erreur : la RLS
// refuse sa lecture aux non-admins (hors mode frais_reels). Le front ne doit
// jamais combler ce vide par un calcul local — c'est le signal « pas le
// droit de voir la marge ».
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { DEFAULT_PARAMS } from './embauches'

// ─── Paramètres de l'organisation ───────────────────────────────────────────

export async function fetchParams(orgId) {
  if (!orgId) return { ...DEFAULT_PARAMS }
  const { data, error } = await supabase
    .from('embauche_params')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) {
    console.error('[embauches] fetchParams:', error)
    return { ...DEFAULT_PARAMS }
  }
  return data ? { ...DEFAULT_PARAMS, ...data } : { ...DEFAULT_PARAMS }
}

/** Crée la ligne de paramètres au premier réglage (admin seul). */
export async function saveParams(orgId, patch) {
  const { data, error } = await supabase
    .from('embauche_params')
    .upsert({ org_id: orgId, ...patch }, { onConflict: 'org_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Dossiers ───────────────────────────────────────────────────────────────

// Les colonnes réelles s'appellent `nom_commercial` et `title` : on les
// renomme ici une bonne fois pour que l'UI parle d'un `nom` dans les deux cas.
const DOSSIER_SELECT = `
  *,
  client:clients(id, nom:nom_commercial),
  project:projects(id, nom:title)
`

export async function listDossiers(orgId, { projectId = null } = {}) {
  if (!orgId) return []
  let q = supabase
    .from('embauche_dossiers')
    .select(DOSSIER_SELECT)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (projectId) q = q.eq('project_id', projectId)

  const { data, error } = await q
  if (error) {
    console.error('[embauches] listDossiers:', error)
    return []
  }
  return data || []
}

export async function fetchDossier(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('embauche_dossiers')
    .select(DOSSIER_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createDossier(payload) {
  const { data, error } = await supabase
    .from('embauche_dossiers')
    .insert(payload)
    .select(DOSSIER_SELECT)
    .single()
  if (error) throw error
  return data
}

export async function updateDossier(id, patch) {
  // Le CHECK base refuse un coefficient non nul en frais réels : on aligne
  // ici plutôt que de laisser remonter une erreur Postgres incompréhensible.
  const next = { ...patch }
  if (next.mode === 'frais_reels') next.coef_vente = 0

  const { data, error } = await supabase
    .from('embauche_dossiers')
    .update(next)
    .eq('id', id)
    .select(DOSSIER_SELECT)
    .single()
  if (error) throw error
  return data
}

export async function deleteDossier(id) {
  const { error } = await supabase.from('embauche_dossiers').delete().eq('id', id)
  if (error) throw error
}

// ─── Embauches ──────────────────────────────────────────────────────────────

const EMBAUCHE_SELECT = `
  *,
  contact:contacts(id, nom, prenom, email, telephone, date_naissance, address, code_postal, ville, regime),
  jours:embauche_jours(*),
  majorations:embauche_majorations(*),
  frais:embauche_frais(*),
  cout:embauche_couts(*)
`

/** Normalise la relation 1-1 `cout`, que PostgREST peut rendre en tableau. */
function normalizeEmbauche(row) {
  if (!row) return row
  const cout = Array.isArray(row.cout) ? (row.cout[0] ?? null) : (row.cout ?? null)
  return {
    ...row,
    cout,
    jours: [...(row.jours || [])].sort((a, b) =>
      String(a.date_jour).localeCompare(String(b.date_jour)),
    ),
    majorations: row.majorations || [],
    frais: [...(row.frais || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
  }
}

export async function listEmbauches(dossierId) {
  if (!dossierId) return []
  const { data, error } = await supabase
    .from('embauches')
    .select(EMBAUCHE_SELECT)
    .eq('dossier_id', dossierId)
    .order('sort_order')
    .order('created_at')
  if (error) {
    console.error('[embauches] listEmbauches:', error)
    return []
  }
  return (data || []).map(normalizeEmbauche)
}

/**
 * Embauches touchant une période, tous dossiers confondus.
 * Sert la vue mensuelle globale de l'accueil.
 *
 * Deux requêtes plutôt qu'une jointure filtrante : filtrer les jours dans le
 * select imbriqué amputerait les totaux (une embauche à cheval sur deux mois
 * perdrait ses jours hors période, et son brut avec).
 */
export async function listEmbauchesPeriode(orgId, debutISO, finISO) {
  if (!orgId || !debutISO || !finISO) return { embauches: [], dossiers: [] }

  const { data: jours, error: errJours } = await supabase
    .from('embauche_jours')
    .select('embauche_id')
    .gte('date_jour', debutISO)
    .lte('date_jour', finISO)
  if (errJours) {
    console.error('[embauches] listEmbauchesPeriode jours:', errJours)
    return { embauches: [], dossiers: [] }
  }

  const ids = [...new Set((jours || []).map((j) => j.embauche_id))]
  if (ids.length === 0) return { embauches: [], dossiers: [] }

  const { data, error } = await supabase
    .from('embauches')
    .select(EMBAUCHE_SELECT)
    .in('id', ids)
  if (error) {
    console.error('[embauches] listEmbauchesPeriode:', error)
    return { embauches: [], dossiers: [] }
  }

  const embauches = (data || []).map(normalizeEmbauche)
  const dossierIds = [...new Set(embauches.map((e) => e.dossier_id))]
  const dossiers = dossierIds.length
    ? ((
        await supabase.from('embauche_dossiers').select(DOSSIER_SELECT).in('id', dossierIds)
      ).data ?? [])
    : []

  return { embauches, dossiers }
}

export async function createEmbauche(payload) {
  const { data, error } = await supabase
    .from('embauches')
    .insert(payload)
    .select(EMBAUCHE_SELECT)
    .single()
  if (error) throw error
  return normalizeEmbauche(data)
}

export async function updateEmbauche(id, patch) {
  const { data, error } = await supabase
    .from('embauches')
    .update(patch)
    .eq('id', id)
    .select(EMBAUCHE_SELECT)
    .single()
  if (error) throw error
  return normalizeEmbauche(data)
}

export async function deleteEmbauche(id) {
  const { error } = await supabase.from('embauches').delete().eq('id', id)
  if (error) throw error
}

export async function reorderEmbauches(ids = []) {
  await Promise.all(
    ids.map((id, i) => supabase.from('embauches').update({ sort_order: i }).eq('id', id)),
  )
}

// ─── Jours, majorations, frais ──────────────────────────────────────────────

const JOUR_FIELDS = [
  'date_jour',
  'heures',
  'heure_debut',
  'heure_fin',
  'nature',
  'heures_nuit',
]

/**
 * Remplace l'intégralité des jours d'une embauche.
 *
 * Suppression puis insertion : le configurateur manipule une sélection
 * entière (on coche et décoche des dates), un diff ligne à ligne coûterait
 * plus qu'il ne rapporte sur quelques dizaines de jours.
 */
export async function saveJours(embaucheId, jours = []) {
  const { error: delErr } = await supabase
    .from('embauche_jours')
    .delete()
    .eq('embauche_id', embaucheId)
  if (delErr) throw delErr

  if (jours.length === 0) return []

  const rows = jours.map((j) => {
    const row = { embauche_id: embaucheId }
    for (const f of JOUR_FIELDS) row[f] = j[f] ?? null
    if (row.heures == null) row.heures = 0
    if (!row.nature) row.nature = 'normal'
    if (row.heures_nuit == null) row.heures_nuit = 0
    return row
  })

  const { data, error } = await supabase.from('embauche_jours').insert(rows).select()
  if (error) throw error
  return data || []
}

export async function saveMajorations(embaucheId, majorations = []) {
  const { error: delErr } = await supabase
    .from('embauche_majorations')
    .delete()
    .eq('embauche_id', embaucheId)
  if (delErr) throw delErr

  // Une majoration à zéro heure n'a rien à faire en base.
  const rows = majorations
    .filter((m) => Number(m.heures) > 0)
    .map((m) => ({
      embauche_id: embaucheId,
      kind: m.kind,
      semaine: m.kind === 'sup' ? m.semaine : null,
      taux: m.taux,
      heures: m.heures,
    }))
  if (rows.length === 0) return []

  const { data, error } = await supabase.from('embauche_majorations').insert(rows).select()
  if (error) throw error
  return data || []
}

export async function saveFrais(embaucheId, frais = []) {
  const { error: delErr } = await supabase
    .from('embauche_frais')
    .delete()
    .eq('embauche_id', embaucheId)
  if (delErr) throw delErr

  const rows = frais
    .filter((f) => Number(f.montant) !== 0)
    .map((f, i) => ({
      embauche_id: embaucheId,
      type: f.type || 'repas',
      libelle: f.libelle || null,
      montant: Number(f.montant) || 0,
      nombre: Number(f.nombre) || 1,
      soumis_cotisations: Boolean(f.soumis_cotisations),
      sort_order: i,
    }))
  if (rows.length === 0) return []

  const { data, error } = await supabase.from('embauche_frais').insert(rows).select()
  if (error) throw error
  return data || []
}

/** Écriture admin seule (policy `embauche_couts_write`). */
export async function saveCout(embaucheId, patch) {
  const { data, error } = await supabase
    .from('embauche_couts')
    .upsert({ embauche_id: embaucheId, ...patch }, { onConflict: 'embauche_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Reprise depuis l'équipe du projet ──────────────────────────────────────

/**
 * Membres d'un projet Desk proposables en embauche, avec leurs jours de
 * présence. Sert le bouton « Reprendre l'équipe » du dossier rattaché.
 */
export async function fetchMembresProjet(projectId) {
  if (!projectId) return []
  const { data, error } = await supabase
    .from('projet_membres')
    .select(
      `id, nom, prenom, specialite, regime, presence_days, budget_convenu, cout_estime,
       contact:contacts(id, nom, prenom, email, telephone, tarif_jour_ref)`,
    )
    .eq('project_id', projectId)
    .is('parent_membre_id', null)
    .order('category')
    .order('sort_order')
  if (error) {
    console.error('[embauches] fetchMembresProjet:', error)
    return []
  }
  return data || []
}

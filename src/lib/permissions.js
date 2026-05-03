// ════════════════════════════════════════════════════════════════════════════
// MOTEUR DE PERMISSIONS — Chantier 3A + 3B
// ════════════════════════════════════════════════════════════════════════════
//
// Ce module est PUR (aucune dépendance React, aucun appel réseau). Toute la
// logique est testable unitairement avec Vitest.
//
// Scope depuis 3B : toutes les permissions sont maintenant résolues PAR PROJET.
//   - Le template métier est lu sur `project_access.metier_template_id` de la
//     ligne (user, projet) — un même humain peut donc être monteur sur un
//     projet et chef op sur un autre.
//   - Les overrides par outil vivent sur `project_access_permissions` et ne
//     s'appliquent qu'au projet courant.
//
// Les appels UI doivent donc instancier un `ctx` par projet (voir le hook
// `useProjectPermissions(projectId)`), et non plus un ctx global par user.
//
// Philosophie inchangée :
//   - Les rôles internes (admin, charge_prod, coordinateur) ont un BYPASS
//     total au niveau du moteur : si `ctx.role` est interne, `can()` renvoie
//     toujours true. Le filtrage côté projet (attachement via project_access)
//     est géré en amont par le hook — le moteur ne voit que les permissions
//     d'un projet où l'utilisateur est bien attaché.
//   - Les prestataires n'ont accès qu'à ce que leur template + overrides
//     autorisent explicitement pour ce projet.
//   - En cas de doute → on refuse (fail-safe).
// ════════════════════════════════════════════════════════════════════════════

// ─── Rôles ──────────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN: 'admin',
  CHARGE_PROD: 'charge_prod',
  COORDINATEUR: 'coordinateur',
  PRESTATAIRE: 'prestataire',
}

/** Rôles qui bypass les permissions prestataire et ont accès à tout */
export const INTERNAL_ROLES = [ROLES.ADMIN, ROLES.CHARGE_PROD, ROLES.COORDINATEUR]

// ─── Outils (miroir de outils_catalogue côté base) ─────────────────────────
export const OUTILS = {
  PROJET_INFO: 'projet_info',
  EQUIPE: 'equipe',
  PLANNING: 'planning',
  CALLSHEET: 'callsheet',
  PRODUCTION: 'production',
  LIVRABLES: 'livrables',
  MATERIEL: 'materiel',
  PLANS: 'plans',
  DECORS: 'decors',
  // BUDGET-PERM (2026-04-20) — gating granulaire des onglets financiers :
  //   DEVIS  → onglet Devis (catalogue, versions, validation client)
  //   BUDGET → onglets Factures + Budget réel + Dashboard projet
  // Voir supabase/migrations/20260420_budget_perm_catalogue.sql.
  DEVIS: 'devis',
  BUDGET: 'budget',
}

// ─── Actions ────────────────────────────────────────────────────────────────
export const ACTIONS = {
  READ: 'read',
  COMMENT: 'comment',
  EDIT: 'edit',
}

// ─── Règles métier ──────────────────────────────────────────────────────────
/**
 * Monotonie des permissions :
 *   edit    implique comment et read
 *   comment implique read
 *   read    n'implique rien d'autre
 *
 * Cette fonction normalise une permission pour appliquer cette règle,
 * afin qu'on ne puisse pas se retrouver avec un utilisateur qui aurait
 * can_edit=true mais can_read=false (incohérent).
 */
function normalize(perm) {
  const read = perm.can_read === true
  const comment = perm.can_comment === true
  const edit = perm.can_edit === true

  return {
    can_read: read || comment || edit,
    can_comment: comment || edit,
    can_edit: edit,
  }
}

/**
 * Construit l'objet `permissions` final pour UN PROJET DONNÉ à partir des
 * lignes template + overrides récupérées sur Supabase.
 *
 * @param {Array} templateRows - Lignes `metier_template_permissions` pour
 *                               le template pointé par project_access.metier_template_id
 * @param {Array} overrideRows - Lignes `project_access_permissions` pour
 *                               (user_id, project_id) courant (peut être vide)
 * @returns {Object} Objet {[outil_key]: {can_read, can_comment, can_edit}}
 *
 * Règle de fusion : un override NON NULL remplace la valeur du template.
 * Un override à NULL (champ non défini) laisse la valeur du template intacte.
 * Monotonie : edit ⊃ comment ⊃ read (appliquée via normalize()).
 */
export function buildProjectPermissions(templateRows = [], overrideRows = []) {
  const out = {}

  // 1) On applique d'abord le template comme base
  for (const row of templateRows) {
    if (!row?.outil_key) continue
    out[row.outil_key] = normalize({
      can_read: row.can_read,
      can_comment: row.can_comment,
      can_edit: row.can_edit,
    })
  }

  // 2) On applique ensuite les overrides par-dessus (NULL = garder le template)
  for (const row of overrideRows) {
    if (!row?.outil_key) continue
    const base = out[row.outil_key] || { can_read: false, can_comment: false, can_edit: false }
    out[row.outil_key] = normalize({
      can_read: row.can_read ?? base.can_read,
      can_comment: row.can_comment ?? base.can_comment,
      can_edit: row.can_edit ?? base.can_edit,
    })
  }

  return out
}

// Alias rétro-compat : ancien nom utilisé par les tests. Conservé pour ne pas
// casser la suite existante — même comportement, même signature.
export const buildPermissions = buildProjectPermissions

/**
 * Vérifie si une action est autorisée sur un outil donné.
 *
 * @param {Object} ctx               - Contexte utilisateur
 * @param {string} ctx.role          - Rôle de l'utilisateur ('admin', 'prestataire'...)
 * @param {Object} ctx.permissions   - Objet permissions (issu de buildPermissions)
 * @param {string} outil             - Clé de l'outil (ex: 'livrables')
 * @param {string} action            - Action demandée ('read', 'comment', 'edit')
 * @returns {boolean}
 *
 * Règles :
 *   1. Rôles internes (admin, charge_prod, coordinateur) → true pour TOUT
 *   2. Prestataire → lecture stricte de l'objet permissions
 *   3. Action inconnue ou outil inconnu → false (fail-safe)
 */
export function can(ctx, outil, action) {
  if (!ctx || !outil || !action) return false

  // Bypass total pour les rôles internes
  if (INTERNAL_ROLES.includes(ctx.role)) return true

  const outilPerms = ctx.permissions?.[outil]
  if (!outilPerms) return false

  switch (action) {
    case ACTIONS.READ:
      return outilPerms.can_read === true
    case ACTIONS.COMMENT:
      return outilPerms.can_comment === true
    case ACTIONS.EDIT:
      return outilPerms.can_edit === true
    default:
      return false
  }
}

/**
 * Helper : vrai si l'utilisateur a au moins une permission (read, comment ou edit)
 * sur un outil. Utile pour filtrer les onglets dans la sidebar projet :
 * on masque un onglet si le prestataire n'a rien du tout dessus.
 */
export function canSee(ctx, outil) {
  return can(ctx, outil, ACTIONS.READ)
}

/**
 * Helper : retourne la liste des outils sur lesquels l'utilisateur a au moins
 * un accès en lecture. Utile pour afficher dynamiquement les menus.
 *
 * @param {Object} ctx - Contexte utilisateur
 * @param {Array}  catalogue - Lignes de outils_catalogue
 * @returns {Array} Les entrées du catalogue filtrées
 */
export function visibleOutils(ctx, catalogue = []) {
  if (INTERNAL_ROLES.includes(ctx?.role)) return catalogue
  return catalogue.filter((o) => canSee(ctx, o.key))
}

/**
 * Helper rôle : vrai si le user a l'un des rôles listés.
 */
export function hasRole(ctx, roles) {
  if (!ctx?.role) return false
  const list = Array.isArray(roles) ? roles : [roles]
  return list.includes(ctx.role)
}

/**
 * Helper rôle : vrai si le user est un rôle interne (admin/charge_prod/coord).
 */
export function isInternal(ctx) {
  return INTERNAL_ROLES.includes(ctx?.role)
}

/**
 * Helper rôle : vrai si le user est un prestataire externe.
 */
export function isPrestataire(ctx) {
  return ctx?.role === ROLES.PRESTATAIRE
}

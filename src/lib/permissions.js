// ════════════════════════════════════════════════════════════════════════════
// MOTEUR DE PERMISSIONS — Chantier 3A
// ════════════════════════════════════════════════════════════════════════════
//
// Ce module est PUR (aucune dépendance React, aucun appel réseau). Toute la
// logique est testable unitairement avec Vitest. Les données d'entrée sont
// les lignes brutes récupérées depuis Supabase (permissions du template et
// overrides utilisateur) et la sortie est un objet permissions exploitable
// par l'UI.
//
// Philosophie :
//   - Les rôles internes (admin, charge_prod, coordinateur) ont un BYPASS
//     total : ils voient tous les outils, peu importe leur template.
//   - Les prestataires n'ont accès qu'à ce que leur template + overrides
//     autorisent explicitement.
//   - En cas de doute → on refuse (fail-safe).
// ════════════════════════════════════════════════════════════════════════════

// ─── Rôles ──────────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN:        'admin',
  CHARGE_PROD:  'charge_prod',
  COORDINATEUR: 'coordinateur',
  PRESTATAIRE:  'prestataire',
}

/** Rôles qui bypass les permissions prestataire et ont accès à tout */
export const INTERNAL_ROLES = [ROLES.ADMIN, ROLES.CHARGE_PROD, ROLES.COORDINATEUR]

// ─── Outils (miroir de outils_catalogue côté base) ─────────────────────────
export const OUTILS = {
  PROJET_INFO: 'projet_info',
  EQUIPE:      'equipe',
  PLANNING:    'planning',
  CALLSHEET:   'callsheet',
  PRODUCTION:  'production',
  LIVRABLES:   'livrables',
  MATERIEL:    'materiel',
  DECORS:      'decors',
}

// ─── Actions ────────────────────────────────────────────────────────────────
export const ACTIONS = {
  READ:    'read',
  COMMENT: 'comment',
  EDIT:    'edit',
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
  const read    = perm.can_read    === true
  const comment = perm.can_comment === true
  const edit    = perm.can_edit    === true

  return {
    can_read:    read    || comment || edit,
    can_comment: comment || edit,
    can_edit:    edit,
  }
}

/**
 * Construit l'objet `permissions` final à partir des lignes template + overrides.
 *
 * @param {Array} templateRows - Lignes de metier_template_permissions pour le template du user
 * @param {Array} overrideRows - Lignes de prestataire_outils pour le user (peut être vide)
 * @returns {Object} Objet {[outil_key]: {can_read, can_comment, can_edit}}
 *
 * Règle de fusion : un override NON NULL remplace la valeur du template.
 * Un override à NULL (champ non défini) laisse la valeur du template intacte.
 */
export function buildPermissions(templateRows = [], overrideRows = []) {
  const out = {}

  // 1) On applique d'abord le template comme base
  for (const row of templateRows) {
    if (!row?.outil_key) continue
    out[row.outil_key] = normalize({
      can_read:    row.can_read,
      can_comment: row.can_comment,
      can_edit:    row.can_edit,
    })
  }

  // 2) On applique ensuite les overrides par-dessus (NULL = garder le template)
  for (const row of overrideRows) {
    if (!row?.outil_key) continue
    const base = out[row.outil_key] || { can_read: false, can_comment: false, can_edit: false }
    out[row.outil_key] = normalize({
      can_read:    row.can_read    ?? base.can_read,
      can_comment: row.can_comment ?? base.can_comment,
      can_edit:    row.can_edit    ?? base.can_edit,
    })
  }

  return out
}

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
    case ACTIONS.READ:    return outilPerms.can_read    === true
    case ACTIONS.COMMENT: return outilPerms.can_comment === true
    case ACTIONS.EDIT:    return outilPerms.can_edit    === true
    default:              return false
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
  return catalogue.filter(o => canSee(ctx, o.key))
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

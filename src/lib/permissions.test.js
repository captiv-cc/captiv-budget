// ════════════════════════════════════════════════════════════════════════════
// TESTS — Moteur de permissions (chantier 3A)
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import {
  ROLES,
  INTERNAL_ROLES,
  OUTILS,
  ACTIONS,
  buildPermissions,
  can,
  canSee,
  visibleOutils,
  hasRole,
  isInternal,
  isPrestataire,
} from './permissions'

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Helper : crée un contexte utilisateur rapide */
function ctx(role, permissions = {}) {
  return { role, permissions }
}

/** Fixture : template Monteur (livrables edit + equipe read + production read) */
const MONTEUR_TEMPLATE = [
  { outil_key: 'livrables', can_read: true, can_comment: true, can_edit: true },
  { outil_key: 'equipe', can_read: true, can_comment: false, can_edit: false },
  { outil_key: 'production', can_read: true, can_comment: false, can_edit: false },
  { outil_key: 'projet_info', can_read: true, can_comment: false, can_edit: false },
]

/** Fixture : template Cadreur */
const CADREUR_TEMPLATE = [
  { outil_key: 'callsheet', can_read: true, can_comment: false, can_edit: false },
  { outil_key: 'planning', can_read: true, can_comment: false, can_edit: false },
  { outil_key: 'equipe', can_read: true, can_comment: false, can_edit: false },
  { outil_key: 'materiel', can_read: true, can_comment: true, can_edit: false },
  { outil_key: 'projet_info', can_read: true, can_comment: false, can_edit: false },
]

/** Fixture : template Réalisateur (read+comment tout + edit livrables) */
const REALISATEUR_TEMPLATE = [
  { outil_key: 'projet_info', can_read: true, can_comment: true, can_edit: false },
  { outil_key: 'equipe', can_read: true, can_comment: true, can_edit: false },
  { outil_key: 'planning', can_read: true, can_comment: true, can_edit: false },
  { outil_key: 'callsheet', can_read: true, can_comment: true, can_edit: false },
  { outil_key: 'production', can_read: true, can_comment: true, can_edit: false },
  { outil_key: 'livrables', can_read: true, can_comment: true, can_edit: true },
  { outil_key: 'materiel', can_read: true, can_comment: true, can_edit: false },
  { outil_key: 'decors', can_read: true, can_comment: true, can_edit: false },
]

/** Fixture : catalogue d'outils minimal */
const CATALOGUE = [
  { key: 'projet_info', label: 'Fiche projet', sort_order: 10 },
  { key: 'equipe', label: 'Équipe', sort_order: 20 },
  { key: 'planning', label: 'Planning', sort_order: 30 },
  { key: 'callsheet', label: 'Call sheet', sort_order: 40 },
  { key: 'production', label: 'Production', sort_order: 50 },
  { key: 'livrables', label: 'Livrables', sort_order: 60 },
  { key: 'materiel', label: 'Matériel', sort_order: 70 },
  { key: 'decors', label: 'Décors', sort_order: 80 },
]

// ─── 1. Constantes ──────────────────────────────────────────────────────────
describe('Constantes exportées', () => {
  it('ROLES contient exactement les 4 rôles attendus', () => {
    expect(ROLES.ADMIN).toBe('admin')
    expect(ROLES.CHARGE_PROD).toBe('charge_prod')
    expect(ROLES.COORDINATEUR).toBe('coordinateur')
    expect(ROLES.PRESTATAIRE).toBe('prestataire')
  })

  it('INTERNAL_ROLES exclut prestataire', () => {
    expect(INTERNAL_ROLES).toHaveLength(3)
    expect(INTERNAL_ROLES).toContain('admin')
    expect(INTERNAL_ROLES).toContain('charge_prod')
    expect(INTERNAL_ROLES).toContain('coordinateur')
    expect(INTERNAL_ROLES).not.toContain('prestataire')
  })

  it('OUTILS contient les outils production historiques', () => {
    expect(OUTILS.LIVRABLES).toBe('livrables')
    expect(OUTILS.CALLSHEET).toBe('callsheet')
    expect(OUTILS.DECORS).toBe('decors')
  })

  it('OUTILS contient DEVIS et BUDGET (BUDGET-PERM 2026-04-20)', () => {
    // Clés utilisées pour gater les onglets Devis / Factures / Budget réel /
    // Dashboard. Miroir de la migration 20260420_budget_perm_catalogue.sql.
    expect(OUTILS.DEVIS).toBe('devis')
    expect(OUTILS.BUDGET).toBe('budget')
  })

  it('ACTIONS contient read / comment / edit', () => {
    expect(ACTIONS.READ).toBe('read')
    expect(ACTIONS.COMMENT).toBe('comment')
    expect(ACTIONS.EDIT).toBe('edit')
  })
})

// ─── 2. buildPermissions — fusion template + overrides ─────────────────────
describe('buildPermissions — template seul', () => {
  it('construit correctement les permissions du Monteur', () => {
    const perms = buildPermissions(MONTEUR_TEMPLATE)
    expect(perms.livrables).toEqual({ can_read: true, can_comment: true, can_edit: true })
    expect(perms.equipe).toEqual({ can_read: true, can_comment: false, can_edit: false })
    expect(perms.callsheet).toBeUndefined()
  })

  it('tableau vide retourne un objet vide', () => {
    expect(buildPermissions([])).toEqual({})
  })

  it('ignore les lignes sans outil_key', () => {
    const rows = [{ outil_key: null, can_read: true }, { can_read: true }]
    expect(buildPermissions(rows)).toEqual({})
  })

  it('monotonie : edit=true force comment et read à true', () => {
    const rows = [{ outil_key: 'x', can_read: false, can_comment: false, can_edit: true }]
    expect(buildPermissions(rows).x).toEqual({
      can_read: true,
      can_comment: true,
      can_edit: true,
    })
  })

  it('monotonie : comment=true force read à true', () => {
    const rows = [{ outil_key: 'x', can_read: false, can_comment: true, can_edit: false }]
    expect(buildPermissions(rows).x).toEqual({
      can_read: true,
      can_comment: true,
      can_edit: false,
    })
  })
})

describe('buildPermissions — avec overrides', () => {
  it('override ajoute un outil absent du template', () => {
    const overrides = [{ outil_key: 'decors', can_read: true, can_comment: false, can_edit: false }]
    const perms = buildPermissions(MONTEUR_TEMPLATE, overrides)
    expect(perms.decors).toEqual({ can_read: true, can_comment: false, can_edit: false })
    expect(perms.livrables.can_edit).toBe(true) // template préservé
  })

  it('override remplace la valeur du template', () => {
    const overrides = [
      { outil_key: 'livrables', can_read: true, can_comment: false, can_edit: false },
    ]
    const perms = buildPermissions(MONTEUR_TEMPLATE, overrides)
    expect(perms.livrables.can_edit).toBe(false)
  })

  it('override NULL préserve la valeur du template', () => {
    const overrides = [
      { outil_key: 'livrables', can_read: null, can_comment: null, can_edit: null },
    ]
    const perms = buildPermissions(MONTEUR_TEMPLATE, overrides)
    expect(perms.livrables.can_edit).toBe(true) // template intact
  })

  it('override partiel : seul can_edit modifié', () => {
    const overrides = [
      { outil_key: 'livrables', can_read: null, can_comment: null, can_edit: false },
    ]
    const perms = buildPermissions(MONTEUR_TEMPLATE, overrides)
    expect(perms.livrables).toEqual({ can_read: true, can_comment: true, can_edit: false })
  })
})

// ─── 3. can() — moteur de décision ──────────────────────────────────────────
describe('can() — bypass rôles internes', () => {
  it('admin a accès à TOUT, même sans permissions', () => {
    const user = ctx(ROLES.ADMIN, {})
    expect(can(user, 'livrables', 'edit')).toBe(true)
    expect(can(user, 'compta', 'edit')).toBe(true)
    expect(can(user, 'inconnu', 'edit')).toBe(true)
  })

  it('charge_prod a accès à tout', () => {
    const user = ctx(ROLES.CHARGE_PROD, {})
    expect(can(user, 'livrables', 'edit')).toBe(true)
    expect(can(user, 'decors', 'comment')).toBe(true)
  })

  it('coordinateur a accès à tout (interne)', () => {
    const user = ctx(ROLES.COORDINATEUR, {})
    expect(can(user, 'materiel', 'edit')).toBe(true)
  })
})

describe('can() — prestataire Monteur', () => {
  const permissions = buildPermissions(MONTEUR_TEMPLATE)
  const user = ctx(ROLES.PRESTATAIRE, permissions)

  it('peut éditer les livrables', () => {
    expect(can(user, 'livrables', 'edit')).toBe(true)
    expect(can(user, 'livrables', 'comment')).toBe(true)
    expect(can(user, 'livrables', 'read')).toBe(true)
  })

  it('peut lire équipe mais pas commenter ni éditer', () => {
    expect(can(user, 'equipe', 'read')).toBe(true)
    expect(can(user, 'equipe', 'comment')).toBe(false)
    expect(can(user, 'equipe', 'edit')).toBe(false)
  })

  it('ne voit PAS callsheet ni planning ni matériel', () => {
    expect(can(user, 'callsheet', 'read')).toBe(false)
    expect(can(user, 'planning', 'read')).toBe(false)
    expect(can(user, 'materiel', 'read')).toBe(false)
  })

  it('ne voit PAS les outils financiers', () => {
    expect(can(user, 'compta', 'read')).toBe(false)
    expect(can(user, 'devis', 'read')).toBe(false)
    expect(can(user, 'bdd', 'read')).toBe(false)
  })
})

describe('can() — prestataire Cadreur', () => {
  const permissions = buildPermissions(CADREUR_TEMPLATE)
  const user = ctx(ROLES.PRESTATAIRE, permissions)

  it('peut lire callsheet, planning, équipe', () => {
    expect(can(user, 'callsheet', 'read')).toBe(true)
    expect(can(user, 'planning', 'read')).toBe(true)
    expect(can(user, 'equipe', 'read')).toBe(true)
  })

  it('peut commenter matériel mais pas éditer', () => {
    expect(can(user, 'materiel', 'read')).toBe(true)
    expect(can(user, 'materiel', 'comment')).toBe(true)
    expect(can(user, 'materiel', 'edit')).toBe(false)
  })

  it('ne voit pas les livrables', () => {
    expect(can(user, 'livrables', 'read')).toBe(false)
  })
})

describe('can() — prestataire Réalisateur', () => {
  const permissions = buildPermissions(REALISATEUR_TEMPLATE)
  const user = ctx(ROLES.PRESTATAIRE, permissions)

  // Liste explicite des outils "production" couverts par REALISATEUR_TEMPLATE.
  // On ne boucle PAS sur Object.values(OUTILS) car depuis BUDGET-PERM
  // (2026-04-20) OUTILS inclut DEVIS/BUDGET qui sont hors scope du template
  // Réalisateur (finance = opt-in explicite, jamais semé par défaut).
  const PRODUCTION_OUTILS = [
    OUTILS.PROJET_INFO,
    OUTILS.EQUIPE,
    OUTILS.PLANNING,
    OUTILS.CALLSHEET,
    OUTILS.PRODUCTION,
    OUTILS.LIVRABLES,
    OUTILS.MATERIEL,
    OUTILS.DECORS,
  ]

  it('peut lire et commenter TOUS les outils production', () => {
    for (const outil of PRODUCTION_OUTILS) {
      expect(can(user, outil, 'read')).toBe(true)
      expect(can(user, outil, 'comment')).toBe(true)
    }
  })

  it('ne peut éditer QUE les livrables', () => {
    expect(can(user, 'livrables', 'edit')).toBe(true)
    expect(can(user, 'callsheet', 'edit')).toBe(false)
    expect(can(user, 'planning', 'edit')).toBe(false)
    expect(can(user, 'decors', 'edit')).toBe(false)
  })

  it('ne voit PAS devis ni budget (finance opt-in explicite)', () => {
    // Le template Réalisateur est "prod-only" : aucun accès finance par défaut.
    expect(can(user, OUTILS.DEVIS, 'read')).toBe(false)
    expect(can(user, OUTILS.BUDGET, 'read')).toBe(false)
    expect(can(user, OUTILS.DEVIS, 'edit')).toBe(false)
    expect(can(user, OUTILS.BUDGET, 'edit')).toBe(false)
  })
})

// ─── 3b. BUDGET-PERM — prestataire avec accès devis/budget explicite ───────
describe('can() — prestataire avec outil devis (BUDGET-PERM)', () => {
  const permissions = buildPermissions([
    { outil_key: 'devis', can_read: true, can_comment: false, can_edit: false },
  ])
  const user = ctx(ROLES.PRESTATAIRE, permissions)

  it('peut lire les devis', () => {
    expect(can(user, OUTILS.DEVIS, 'read')).toBe(true)
  })
  it('ne peut PAS éditer les devis (read-only)', () => {
    expect(can(user, OUTILS.DEVIS, 'edit')).toBe(false)
  })
  it('ne voit PAS le budget (outil séparé)', () => {
    // Confirme la séparation 'devis' vs 'budget' : donner l'un ne donne pas l'autre.
    expect(can(user, OUTILS.BUDGET, 'read')).toBe(false)
  })
})

describe('can() — prestataire avec outil budget (BUDGET-PERM)', () => {
  const permissions = buildPermissions([
    { outil_key: 'budget', can_read: true, can_comment: false, can_edit: true },
  ])
  const user = ctx(ROLES.PRESTATAIRE, permissions)

  it('peut lire ET éditer le budget (factures + budget réel + dashboard)', () => {
    expect(can(user, OUTILS.BUDGET, 'read')).toBe(true)
    expect(can(user, OUTILS.BUDGET, 'edit')).toBe(true)
  })
  it('ne voit PAS les devis (outil séparé)', () => {
    expect(can(user, OUTILS.DEVIS, 'read')).toBe(false)
    expect(can(user, OUTILS.DEVIS, 'edit')).toBe(false)
  })
})

describe('can() — cas limites', () => {
  it('ctx null → false', () => {
    expect(can(null, 'livrables', 'read')).toBe(false)
  })

  it('outil manquant → false', () => {
    expect(can(ctx(ROLES.PRESTATAIRE), null, 'read')).toBe(false)
  })

  it('action manquante → false', () => {
    expect(can(ctx(ROLES.PRESTATAIRE, { livrables: { can_read: true } }), 'livrables', null)).toBe(
      false,
    )
  })

  it('action inconnue → false (fail-safe)', () => {
    const user = ctx(ROLES.PRESTATAIRE, { livrables: { can_read: true } })
    expect(can(user, 'livrables', 'delete')).toBe(false)
    expect(can(user, 'livrables', 'publish')).toBe(false)
  })

  it('prestataire sans permissions → accès nul', () => {
    const user = ctx(ROLES.PRESTATAIRE, {})
    expect(can(user, 'livrables', 'read')).toBe(false)
  })
})

// ─── 4. canSee() et visibleOutils() ────────────────────────────────────────
describe('canSee()', () => {
  it('équivaut à can(user, outil, "read")', () => {
    const user = ctx(ROLES.PRESTATAIRE, buildPermissions(MONTEUR_TEMPLATE))
    expect(canSee(user, 'livrables')).toBe(true)
    expect(canSee(user, 'callsheet')).toBe(false)
  })
})

describe('visibleOutils()', () => {
  it('retourne tout le catalogue pour un admin', () => {
    const user = ctx(ROLES.ADMIN)
    expect(visibleOutils(user, CATALOGUE)).toHaveLength(8)
  })

  it('retourne uniquement les outils lisibles par le Monteur', () => {
    const user = ctx(ROLES.PRESTATAIRE, buildPermissions(MONTEUR_TEMPLATE))
    const visibles = visibleOutils(user, CATALOGUE).map((o) => o.key)
    expect(visibles).toContain('livrables')
    expect(visibles).toContain('equipe')
    expect(visibles).toContain('production')
    expect(visibles).toContain('projet_info')
    expect(visibles).not.toContain('callsheet')
    expect(visibles).not.toContain('materiel')
    expect(visibles).toHaveLength(4)
  })

  it('retourne 8 outils pour le Réalisateur (accès complet)', () => {
    const user = ctx(ROLES.PRESTATAIRE, buildPermissions(REALISATEUR_TEMPLATE))
    expect(visibleOutils(user, CATALOGUE)).toHaveLength(8)
  })

  it('catalogue vide → tableau vide', () => {
    const user = ctx(ROLES.ADMIN)
    expect(visibleOutils(user, [])).toEqual([])
  })
})

// ─── 5. Helpers rôle ────────────────────────────────────────────────────────
describe('hasRole()', () => {
  it('accepte un rôle unique en string', () => {
    expect(hasRole(ctx(ROLES.ADMIN), 'admin')).toBe(true)
    expect(hasRole(ctx(ROLES.ADMIN), 'charge_prod')).toBe(false)
  })

  it('accepte un tableau de rôles', () => {
    expect(hasRole(ctx(ROLES.CHARGE_PROD), ['admin', 'charge_prod'])).toBe(true)
    expect(hasRole(ctx(ROLES.PRESTATAIRE), ['admin', 'charge_prod'])).toBe(false)
  })

  it('ctx vide → false', () => {
    expect(hasRole(null, 'admin')).toBe(false)
    expect(hasRole({}, 'admin')).toBe(false)
  })
})

describe('isInternal() / isPrestataire()', () => {
  it('isInternal vrai pour les 3 rôles internes', () => {
    expect(isInternal(ctx(ROLES.ADMIN))).toBe(true)
    expect(isInternal(ctx(ROLES.CHARGE_PROD))).toBe(true)
    expect(isInternal(ctx(ROLES.COORDINATEUR))).toBe(true)
  })

  it('isInternal faux pour prestataire', () => {
    expect(isInternal(ctx(ROLES.PRESTATAIRE))).toBe(false)
  })

  it("isPrestataire est l'inverse sur le seul cas prestataire", () => {
    expect(isPrestataire(ctx(ROLES.PRESTATAIRE))).toBe(true)
    expect(isPrestataire(ctx(ROLES.ADMIN))).toBe(false)
  })
})

// ─── 6. Invariants globaux ──────────────────────────────────────────────────
describe('Invariants globaux', () => {
  it('les 3 rôles internes ne dépendent JAMAIS du champ permissions', () => {
    for (const role of INTERNAL_ROLES) {
      const user = ctx(role, {})
      expect(can(user, 'anything_at_all', 'edit')).toBe(true)
    }
  })

  it('un prestataire sans template ne voit absolument rien', () => {
    const user = ctx(ROLES.PRESTATAIRE, buildPermissions([]))
    for (const outil of Object.values(OUTILS)) {
      expect(canSee(user, outil)).toBe(false)
    }
  })

  it('le catalogue et la matrice de permissions sont disjoints', () => {
    // Aucune contamination entre templates (vérification paranoïaque)
    const monteurPerms = buildPermissions(MONTEUR_TEMPLATE)
    const cadreurPerms = buildPermissions(CADREUR_TEMPLATE)
    expect(monteurPerms.callsheet).toBeUndefined()
    expect(cadreurPerms.livrables).toBeUndefined()
  })
})

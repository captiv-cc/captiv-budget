/**
 * Tests unitaires des helpers du Budget Réel
 * -----------------------------------------------------------------------------
 * Couvre src/features/budget-reel/utils.js (extraits du refacto BudgetReelTab) :
 *   - isIntermittentLike : reconnaissance des régimes intermittents
 *   - refCout            : coût de référence d'une ligne (budget convenu vs devis)
 *   - memberName         : formatage prénom + nom d'un membre
 *
 * Lancer : npm run test
 */
import { describe, it, expect } from 'vitest'
import { isIntermittentLike, refCout, memberName, TAUX_INTERM } from './utils'

describe('TAUX_INTERM', () => {
  it('vaut 0.67 (taux de charges patronales intermittents)', () => {
    expect(TAUX_INTERM).toBe(0.67)
  })
})

describe('isIntermittentLike', () => {
  it('reconnaît un Intermittent Technicien', () => {
    expect(isIntermittentLike('Intermittent Technicien')).toBe(true)
  })

  it('reconnaît un Intermittent Artiste', () => {
    expect(isIntermittentLike('Intermittent Artiste')).toBe(true)
  })

  it('reconnaît un Ext. Intermittent (cas externe payé en cachets)', () => {
    expect(isIntermittentLike('Ext. Intermittent')).toBe(true)
  })

  it("ne reconnaît pas un Externe classique", () => {
    expect(isIntermittentLike('Externe')).toBe(false)
  })

  it("ne reconnaît pas un Interne", () => {
    expect(isIntermittentLike('Interne')).toBe(false)
  })

  it("ne reconnaît pas Frais", () => {
    expect(isIntermittentLike('Frais')).toBe(false)
  })

  it("ne reconnaît pas Technique", () => {
    expect(isIntermittentLike('Technique')).toBe(false)
  })

  it("renvoie false sur undefined / null / chaîne vide", () => {
    expect(isIntermittentLike(undefined)).toBe(false)
    expect(isIntermittentLike(null)).toBe(false)
    expect(isIntermittentLike('')).toBe(false)
  })
})

describe('refCout', () => {
  // ─── Sans budget convenu : on tombe sur le calcul du devis (calcLine) ────
  it("sans budget convenu : utilise calcLine().coutCharge sur Frais (pas de cotisations)", () => {
    // Frais : pas de charges patronales → coutCharge = cout_ht * quantite
    const line = { regime: 'Frais', cout_ht: 100, quantite: 1, nb: 1 }
    expect(refCout(line, null)).toBe(100)
  })

  it("sans budget convenu : prend en compte la quantité × nb", () => {
    const line = { regime: 'Frais', cout_ht: 50, quantite: 2, nb: 3 }
    expect(refCout(line, null)).toBe(300)
  })

  it("sans membre du tout : se comporte comme avec un membre sans budget_convenu", () => {
    const line = { regime: 'Frais', cout_ht: 80, quantite: 1, nb: 1 }
    expect(refCout(line, undefined)).toBe(80)
  })

  // ─── Avec budget convenu : ce dernier prime sur le devis ─────────────────
  it("avec budget convenu : utilise le budget convenu tel quel pour un Externe", () => {
    const line = { regime: 'Externe', cout_ht: 999, quantite: 5, nb: 2 }
    const membre = { budget_convenu: 1000 }
    expect(refCout(line, membre)).toBe(1000)
  })

  it("avec budget convenu : majore par 1 + TAUX_INTERM pour un Intermittent Technicien", () => {
    const line = { regime: 'Intermittent Technicien', cout_ht: 0 }
    const membre = { budget_convenu: 1000 }
    // 1000 × 1.67 = 1670
    expect(refCout(line, membre)).toBeCloseTo(1670, 5)
  })

  it("avec budget convenu : majore aussi pour un Intermittent Artiste", () => {
    const line = { regime: 'Intermittent Artiste', cout_ht: 0 }
    const membre = { budget_convenu: 500 }
    expect(refCout(line, membre)).toBeCloseTo(835, 5) // 500 × 1.67
  })

  it("avec budget convenu : majore aussi pour un Ext. Intermittent", () => {
    const line = { regime: 'Ext. Intermittent', cout_ht: 0 }
    const membre = { budget_convenu: 200 }
    expect(refCout(line, membre)).toBeCloseTo(334, 5) // 200 × 1.67
  })

  it("budget convenu = 0 : on prend bien 0, pas de fallback sur le devis", () => {
    const line = { regime: 'Externe', cout_ht: 999 }
    const membre = { budget_convenu: 0 }
    expect(refCout(line, membre)).toBe(0)
  })

  it("budget_convenu = null : tombe en fallback sur le calcul devis", () => {
    const line = { regime: 'Frais', cout_ht: 42, quantite: 1, nb: 1 }
    const membre = { budget_convenu: null }
    expect(refCout(line, membre)).toBe(42)
  })
})

describe('memberName', () => {
  it("formate prénom + nom", () => {
    expect(memberName({ prenom: 'Hugo', nom: 'Martin' })).toBe('Hugo Martin')
  })

  it("accepte un prénom seul", () => {
    expect(memberName({ prenom: 'Hugo', nom: '' })).toBe('Hugo')
  })

  it("accepte un nom seul", () => {
    expect(memberName({ prenom: '', nom: 'Martin' })).toBe('Martin')
  })

  it("trim les espaces accidentels", () => {
    expect(memberName({ prenom: '  Hugo  ', nom: '  Martin  ' })).toBe('Hugo     Martin')
    // Note: le trim n'est appliqué qu'aux extrémités, pas entre les deux.
    // Ce test verrouille le comportement actuel.
  })

  it("renvoie null si membre est null/undefined", () => {
    expect(memberName(null)).toBeNull()
    expect(memberName(undefined)).toBeNull()
  })

  it("renvoie null si prénom et nom sont vides", () => {
    expect(memberName({ prenom: '', nom: '' })).toBeNull()
  })

  it("renvoie null si prénom et nom sont absents", () => {
    expect(memberName({})).toBeNull()
  })
})

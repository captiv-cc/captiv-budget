/**
 * Helpers communs au Budget Réel.
 *
 * Extraits de BudgetReelTab.jsx — chantier refacto.
 */

import { calcLine, REGIMES_SALARIES } from '../../lib/cotisations'

export const TAUX_INTERM = 0.67

export function isIntermittentLike(regime) {
  return REGIMES_SALARIES.includes(regime) || regime === 'Ext. Intermittent'
}

/**
 * Coût de référence d'une ligne :
 * Si le membre a un budget_convenu (tarif négocié dans Équipe) → on l'utilise
 * (× 1+taux si intermittent pour inclure les charges patronales)
 * Sinon → coutCharge du devis (calcul standard)
 */
export function refCout(line, membre) {
  const bc = membre?.budget_convenu
  if (bc != null) {
    return isIntermittentLike(line.regime) ? bc * (1 + TAUX_INTERM) : bc
  }
  return calcLine(line).coutCharge
}

export function memberName(m) {
  if (!m) return null
  return `${m.prenom || ''} ${m.nom || ''}`.trim() || null
}

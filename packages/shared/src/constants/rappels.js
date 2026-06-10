// ════════════════════════════════════════════════════════════════════════════
// Constantes rappels créneaux (push notifications)
// ════════════════════════════════════════════════════════════════════════════
//
// Délais possibles avant un créneau pour recevoir une notification push.
// Source unique de vérité utilisée :
// - Côté mobile dans le picker Profil
// - Côté Edge function send-push (calcul du moment d'envoi)
// - Côté table user_settings (validation valeurs autorisées)
//
// ════════════════════════════════════════════════════════════════════════════

/**
 * Valeurs autorisées pour le délai de rappel (en minutes).
 * Doivent matcher l'enum / CHECK constraint Postgres.
 */
export const DELAI_RAPPEL_MINUTES = [5, 15, 30, 45, 60, 120]

/**
 * Valeur par défaut quand l'utilisateur n'a rien configuré.
 */
export const DELAI_RAPPEL_DEFAUT = 15

/**
 * Label formaté pour l'affichage UI.
 */
export const DELAI_RAPPEL_LABEL = {
  5: '5 minutes avant',
  15: '15 minutes avant',
  30: '30 minutes avant',
  45: '45 minutes avant',
  60: '1 heure avant',
  120: '2 heures avant',
}

/**
 * Label court pour les chips/badges.
 */
export const DELAI_RAPPEL_LABEL_COURT = {
  5: '5 min',
  15: '15 min',
  30: '30 min',
  45: '45 min',
  60: '1 h',
  120: '2 h',
}

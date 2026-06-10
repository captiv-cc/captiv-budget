// ════════════════════════════════════════════════════════════════════════════
// PresenceAvatars — Re-export depuis src/components (compat path historique)
// ════════════════════════════════════════════════════════════════════════════
//
// Le composant a été déplacé vers src/components/PresenceAvatars.jsx car il
// est désormais utilisé cross-onglet (cf. CHANTIER_PRESENCE_GLOBALE).
// Ce fichier reste pour ne pas casser les imports existants ; il pourra être
// supprimé une fois tous les sites d'import migrés vers le nouveau chemin.
// ════════════════════════════════════════════════════════════════════════════

export { default } from '../../../components/PresenceAvatars'

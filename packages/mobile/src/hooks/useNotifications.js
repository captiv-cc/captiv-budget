// ════════════════════════════════════════════════════════════════════════════
// useNotifications — re-export depuis le Context (single source)
// ════════════════════════════════════════════════════════════════════════════
//
// La logique vit dans NotificationsContext pour garantir UNE seule instance
// (fetch + channel Realtime) partagée entre le badge tab bar et l'écran.
// Provider monté dans App.js sous <AuthProvider>.
//
// ════════════════════════════════════════════════════════════════════════════

export { useNotifications } from '../lib/NotificationsContext'

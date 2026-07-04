// ════════════════════════════════════════════════════════════════════════════
// PushManager — monte l'enregistrement push + route les taps vers le créneau
// ════════════════════════════════════════════════════════════════════════════
//
// Monté sous AuthProvider. Ne rend rien. Gère :
// - register token + handlers (via usePushNotifications)
// - tap notif (app ouverte/arrière-plan) → ouvre le créneau
// - cold start (app tuée relancée par une notif) → ouvre le créneau
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'

import { usePushNotifications } from '../hooks/usePushNotifications'
import {
  creneauIdFromNotif,
  openCreneauFromPush,
  devisIdFromNotif,
  openDevisFromPush,
} from '../navigation/navigationRef'

// Route le payload d'une notif vers le bon écran (créneau ou devis)
function routeNotifData(data) {
  const creneauId = creneauIdFromNotif(data)
  if (creneauId) {
    openCreneauFromPush(creneauId)
    return
  }
  const devisId = devisIdFromNotif(data, data?.link_web)
  if (devisId) openDevisFromPush(devisId)
}

export default function PushManager() {
  const handleTap = (response) => {
    routeNotifData(response?.notification?.request?.content?.data)
  }

  usePushNotifications({ onTap: handleTap })

  // Cold start : l'app a été lancée par le tap d'une notif (état tué)
  useEffect(() => {
    let mounted = true
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (!mounted || !resp) return
      const data = resp.notification?.request?.content?.data
      if (data) setTimeout(() => routeNotifData(data), 600) // laisse la nav se monter
    })
    return () => {
      mounted = false
    }
  }, [])

  return null
}

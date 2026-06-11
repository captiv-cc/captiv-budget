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
import { creneauIdFromNotif, openCreneauFromPush } from '../navigation/navigationRef'

export default function PushManager() {
  const handleTap = (response) => {
    const data = response?.notification?.request?.content?.data
    const id = creneauIdFromNotif(data)
    if (id) openCreneauFromPush(id)
  }

  usePushNotifications({ onTap: handleTap })

  // Cold start : l'app a été lancée par le tap d'une notif (état tué)
  useEffect(() => {
    let mounted = true
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (!mounted || !resp) return
      const id = creneauIdFromNotif(resp.notification?.request?.content?.data)
      if (id) setTimeout(() => openCreneauFromPush(id), 600) // laisse la nav se monter
    })
    return () => {
      mounted = false
    }
  }, [])

  return null
}

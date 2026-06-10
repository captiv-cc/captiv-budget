// ════════════════════════════════════════════════════════════════════════════
// usePushNotifications — enregistrement + handlers Expo Notifications
// ════════════════════════════════════════════════════════════════════════════
//
// Cycle de vie :
// 1. Au mount, si l'utilisateur est connecté :
//    - vérifie/demande la permission notifications
//    - récupère le push token Expo
//    - upsert dans `push_tokens` (Supabase)
// 2. Subscribe aux notifications reçues :
//    - foreground : affiche un toast in-app (TODO)
//    - background : iOS/Android affiche la notif native, tap → deep link
// 3. Au unmount : unsubscribe
//
// Conseils Apple :
// - NE PAS demander la permission au démarrage (1ère taux refus → -90%)
// - DEMANDER au moment où l'utilisateur veut activer (toggle Profil)
// - Bouton "Activer notifs" en empty state si jamais désactivé
//
// V1 : on demande au premier mount si l'user est connecté. Pour V2 : timing
// plus malin (après 1ère navigation, ou explicite via Profil).
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'

import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// Comportement quand une notif arrive en foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) {
    // eslint-disable-next-line no-console
    console.warn('[Push] Simulateur détecté — les push réelles ne marchent que sur device physique.')
    return null
  }

  // Android : créer un channel par défaut (sinon notifs muettes)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3B82F6',
    })
  }

  // Demander permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') {
    // eslint-disable-next-line no-console
    console.warn('[Push] Permission refusée par l\'utilisateur.')
    return null
  }

  // Récupérer le token Expo
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId
    if (!projectId) {
      // eslint-disable-next-line no-console
      console.warn(
        '[Push] EAS projectId manquant. Configurer dans app.json `extra.eas.projectId` ou via `eas init`.',
      )
    }
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId })
    return tokenData.data
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Push] Erreur récupération token:', err.message)
    return null
  }
}

async function upsertPushToken({ userId, token, deviceName }) {
  if (!userId || !token) return
  try {
    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        expo_token: token,
        platform: Platform.OS,
        device_name: deviceName ?? Device.deviceName ?? null,
        device_os: `${Platform.OS} ${Device.osVersion ?? ''}`.trim(),
        app_version: Constants.expoConfig?.version ?? null,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'user_id,expo_token' },
    )
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[Push] upsert push_token error', error.message)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Push] upsert exception', err.message)
  }
}

/**
 * Hook usePushNotifications.
 *
 * @param {Object} opts
 * @param {(notification) => void} [opts.onReceive] - notif reçue en foreground
 * @param {(response) => void} [opts.onTap] - notif tappée (déclenche deep link)
 * @param {boolean} [opts.enabled=true] - skip register/subscribe si false
 */
export function usePushNotifications({ onReceive, onTap, enabled = true } = {}) {
  const { user } = useAuth()
  const tokenRef = useRef(null)
  const notifListener = useRef(null)
  const responseListener = useRef(null)

  // Register
  useEffect(() => {
    if (!enabled || !user?.id) return
    let cancelled = false

    registerForPushNotificationsAsync().then((token) => {
      if (cancelled || !token) return
      tokenRef.current = token
      upsertPushToken({ userId: user.id, token })
    })

    return () => {
      cancelled = true
    }
  }, [enabled, user?.id])

  // Subscribe handlers
  useEffect(() => {
    if (!enabled) return

    notifListener.current = Notifications.addNotificationReceivedListener((notification) => {
      onReceive?.(notification)
    })

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      onTap?.(response)
    })

    return () => {
      if (notifListener.current) {
        Notifications.removeNotificationSubscription(notifListener.current)
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current)
      }
    }
  }, [enabled, onReceive, onTap])

  const sendTestPush = useCallback(async () => {
    if (!user?.id) return
    try {
      const { data, error } = await supabase.functions.invoke('send-push', {
        body: {
          user_ids: [user.id],
          type: 'test',
          titre: 'Test DESK',
          corps: 'Si tu vois ce message, les push notifications marchent ✨',
        },
      })
      if (error) throw error
      return data
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Push] sendTestPush failed', err.message)
      throw err
    }
  }, [user?.id])

  return { token: tokenRef.current, sendTestPush }
}

// ════════════════════════════════════════════════════════════════════════════
// push — helpers d'envoi (test) via l'Edge Function send-push
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

/** Envoie une notif test à soi-même (via send-push). */
export async function sendTestPush(userId) {
  if (!userId) throw new Error('userId manquant')
  const { data, error } = await supabase.functions.invoke('send-push', {
    body: {
      user_ids: [userId],
      type: 'test',
      titre: 'Test DESK ✨',
      corps: 'Si tu vois ce message, les push notifications marchent.',
    },
  })
  if (error) throw error
  return data
}

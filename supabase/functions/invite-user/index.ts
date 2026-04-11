/**
 * Edge Function : invite-user
 * ---------------------------
 * Invite un utilisateur à rejoindre CAPTIV (ou relance une invite existante).
 *
 * Entrée (JSON) :
 *   {
 *     contact_id: uuid,     // contact à lier (obligatoire)
 *     email:      string,   // email du destinataire
 *     full_name:  string,   // nom complet (optionnel, on tente contact.nom si vide)
 *     role:       string,   // 'prestataire' | 'coordinateur' | 'charge_prod' (défaut: prestataire)
 *     mode:       'email' | 'link',  // email : envoie l'invite ; link : renvoie l'URL
 *     resend?:    boolean,  // true = relance une invite pending existante
 *   }
 *
 * Sortie :
 *   { success: true, user_id, mode, resend, action_link? }
 *
 * Sécurité :
 *   - L'appelant doit être authentifié (JWT dans l'en-tête Authorization)
 *   - L'appelant doit avoir le rôle 'admin' ou 'charge_prod'
 *   - Le contact doit appartenir à la même org que l'appelant
 *   - Nouvelle invite : le contact ne doit pas déjà être lié à un user
 *   - Resend : le contact doit avoir un user_id ET une entrée pending dans invitations_log
 */

// @ts-ignore - Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders } from '../_shared/cors.ts'

// @ts-ignore - Deno global
declare const Deno: { env: { get(key: string): string | undefined }; serve: (handler: (req: Request) => Promise<Response>) => void }

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    const body = await req.json()
    const {
      contact_id,
      email,
      full_name,
      role = 'prestataire',
      mode = 'email',
      resend = false,
    } = body || {}

    if (!contact_id || !email) {
      return jsonResponse(400, { error: 'contact_id et email sont requis' })
    }
    if (mode !== 'email' && mode !== 'link') {
      return jsonResponse(400, { error: "mode doit être 'email' ou 'link'" })
    }
    const validRoles = ['prestataire', 'coordinateur', 'charge_prod']
    if (!validRoles.includes(role)) {
      return jsonResponse(400, { error: `role invalide (${validRoles.join(', ')})` })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse(401, { error: 'Authorization header manquant' })
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) {
      return jsonResponse(401, { error: 'JWT manquant dans Authorization header' })
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return jsonResponse(401, {
        error: 'Token invalide : ' + (userErr?.message || 'user null'),
      })
    }
    const callerId = userData.user.id

    const { data: callerProfile, error: callerErr } = await adminClient
      .from('profiles')
      .select('id, role, org_id, full_name')
      .eq('id', callerId)
      .single()

    if (callerErr || !callerProfile) {
      return jsonResponse(403, { error: 'Profil appelant introuvable' })
    }
    if (!['admin', 'charge_prod'].includes(callerProfile.role)) {
      return jsonResponse(403, { error: 'Seuls les admins et chargés de prod peuvent inviter' })
    }
    if (!callerProfile.org_id) {
      return jsonResponse(400, { error: 'Appelant non rattaché à une org' })
    }

    const { data: contact, error: ctErr } = await adminClient
      .from('contacts')
      .select('id, nom, prenom, org_id, user_id, email')
      .eq('id', contact_id)
      .single()

    if (ctErr || !contact) {
      return jsonResponse(404, { error: 'Contact introuvable' })
    }
    if (contact.org_id !== callerProfile.org_id) {
      return jsonResponse(403, { error: "Ce contact n'appartient pas à votre organisation" })
    }

    if (!resend && contact.user_id) {
      return jsonResponse(400, {
        error: 'Ce contact est déjà lié à un compte (utilisez resend=true pour relancer)',
      })
    }
    if (resend && !contact.user_id) {
      return jsonResponse(400, {
        error: 'Aucun compte à relancer pour ce contact',
      })
    }

    let pendingLogId: string | null = null
    if (resend) {
      const { data: pendingLog } = await adminClient
        .from('invitations_log')
        .select('id, accepted_at')
        .eq('contact_id', contact_id)
        .is('accepted_at', null)
        .order('invited_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!pendingLog) {
        return jsonResponse(400, {
          error: 'Aucune invitation en attente à relancer (déjà acceptée ?)',
        })
      }
      pendingLogId = pendingLog.id
    }

    const finalName =
      full_name ||
      [contact.prenom, contact.nom].filter(Boolean).join(' ').trim() ||
      email

    const metadata = {
      full_name: finalName,
      org_id: callerProfile.org_id,
      role,
      contact_id,
      invited_by: callerId,
    }

    const origin = req.headers.get('origin') || req.headers.get('referer') || ''
    const cleanOrigin = origin.replace(/\/$/, '').replace(/\/accept-invite.*$/, '')
    const redirectTo = cleanOrigin ? `${cleanOrigin}/accept-invite` : undefined

    let newUserId: string = contact.user_id || ''
    let actionLink: string | null = null

    if (mode === 'link') {
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: metadata, redirectTo },
      })
      if (error) return jsonResponse(400, { error: 'generateLink: ' + error.message })
      if (data.user?.id) newUserId = data.user.id
      // @ts-ignore
      actionLink = data.properties?.action_link || null
    } else {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        { data: metadata, redirectTo },
      )
      if (error) return jsonResponse(400, { error: 'inviteUserByEmail: ' + error.message })
      if (data.user?.id) newUserId = data.user.id
    }

    if (!newUserId) {
      return jsonResponse(500, { error: "Création du user échouée (id manquant)" })
    }

    if (!resend) {
      const { error: profErr } = await adminClient
        .from('profiles')
        .upsert(
          {
            id: newUserId,
            org_id: callerProfile.org_id,
            full_name: finalName,
            role,
          },
          { onConflict: 'id' },
        )
      if (profErr) {
        return jsonResponse(500, { error: 'Création profil : ' + profErr.message })
      }

      const { error: linkErr } = await adminClient
        .from('contacts')
        .update({ user_id: newUserId })
        .eq('id', contact_id)
      if (linkErr) {
        return jsonResponse(500, { error: 'Liaison contact : ' + linkErr.message })
      }
    }

    if (resend && pendingLogId) {
      const { data: current } = await adminClient
        .from('invitations_log')
        .select('resend_count')
        .eq('id', pendingLogId)
        .single()

      const { error: logErr } = await adminClient
        .from('invitations_log')
        .update({
          last_resent_at: new Date().toISOString(),
          resend_count: (current?.resend_count || 0) + 1,
          mode,
        })
        .eq('id', pendingLogId)
      if (logErr) {
        console.error('[invite-user] log update failed:', logErr.message)
      }
    } else {
      const { error: logErr } = await adminClient
        .from('invitations_log')
        .insert({
          org_id: callerProfile.org_id,
          contact_id,
          email,
          full_name: finalName,
          role,
          mode,
          invited_by: callerId,
        })
      if (logErr) {
        console.error('[invite-user] log insert failed:', logErr.message)
      }
    }

    return jsonResponse(200, {
      success: true,
      user_id: newUserId,
      mode,
      resend,
      action_link: actionLink,
      email,
      full_name: finalName,
      role,
    })
  } catch (err) {
    console.error('[invite-user] uncaught:', err)
    return jsonResponse(500, { error: (err as Error).message || 'Erreur inconnue' })
  }
})

// Version "tout-en-un" pour copier-coller dans l'éditeur web Supabase.
// Elle est équivalente à index.ts + _shared/cors.ts fusionnés.
// À ne PAS utiliser pour le déploiement CLI (préférer index.ts).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
    // Extraction du JWT (format attendu : "Bearer xxxx")
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) {
      return jsonResponse(401, { error: 'JWT manquant dans Authorization header' })
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Client admin (service_role) pour toutes les opérations privilégiées
    // ET pour vérifier le JWT de l'appelant via getUser(jwt).
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Vérification du JWT de l'appelant : on passe explicitement le token
    // à getUser() pour que le SDK appelle /auth/v1/user avec ce JWT.
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
    if (contact.user_id) {
      return jsonResponse(400, { error: 'Ce contact est déjà lié à un compte' })
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

    let newUserId: string
    let actionLink: string | null = null

    if (mode === 'link') {
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { data: metadata },
      })
      if (error) return jsonResponse(400, { error: 'generateLink: ' + error.message })
      newUserId = data.user?.id || ''
      // @ts-ignore
      actionLink = data.properties?.action_link || null
    } else {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        { data: metadata },
      )
      if (error) return jsonResponse(400, { error: 'inviteUserByEmail: ' + error.message })
      newUserId = data.user?.id || ''
    }

    if (!newUserId) {
      return jsonResponse(500, { error: "Création du user échouée (id manquant)" })
    }

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

    return jsonResponse(200, {
      success: true,
      user_id: newUserId,
      mode,
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
